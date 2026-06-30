import { env } from '../config/env';
import { isDatabaseConfigured, prisma } from '../config/prisma';
import { G1ReadingEvent, tzoneGateway } from './tzone.gateway';
import { TzoneDeviceSummary, TzoneReadingPayload } from './tzone.types';

type PersistedReadingMetadata = {
  source?: 'tzone' | 'g1';
  deviceType?: string | null;
  gatewayMac?: string | null;
  bleName?: string | null;
  rssi?: number | null;
  gatewayFree?: number | null;
  gatewayLoad?: number | null;
};

export class TzoneService {
  private readonly onlineWindowMs = env.TZONE_ONLINE_WINDOW_MINUTES * 60 * 1000;
  private readonly g1ProtocolTypes = new Set(['g1-mqtt-json', 'g1-http-json']);
  private readonly inMemoryReadings: TzoneReadingPayload[] = [];
  private readonly inMemoryLimit = 500;

  private isDeviceOnline(lastSeenAt: Date) {
    return Date.now() - lastSeenAt.getTime() <= this.onlineWindowMs;
  }

  private isCanonicalImei(imei: string | null) {
    return imei !== null && (this.isCanonicalTzoneImei(imei) || this.isCanonicalG1Mac(imei));
  }

  private isSourceForProtocol(
    source: 'tzone' | 'g1',
    protocolType: string | null | undefined
  ) {
    if (source === 'g1') {
      return protocolType !== null && protocolType !== undefined && this.g1ProtocolTypes.has(protocolType);
    }

    return protocolType === null || protocolType === undefined || !this.g1ProtocolTypes.has(protocolType);
  }

  private isIdentifierForSource(source: 'tzone' | 'g1', imei: string | null) {
    return source === 'g1' ? this.isCanonicalG1Mac(imei) : this.isCanonicalTzoneImei(imei);
  }

  private isCanonicalTzoneImei(imei: string | null) {
    return imei !== null && /^\d{15}$/.test(imei);
  }

  private isCanonicalG1Mac(identifier: string | null) {
    return identifier !== null && /^[A-F0-9]{12}$/i.test(identifier);
  }

  private isTrustedDeviceReading(payload: TzoneReadingPayload) {
    if (payload.source === 'g1') {
      return this.isCanonicalG1Mac(payload.imei);
    }

    return this.isCanonicalTzoneImei(payload.imei);
  }

  private rememberReading(payload: TzoneReadingPayload) {
    this.inMemoryReadings.unshift({
      ...payload,
      receivedAt: new Date(payload.receivedAt.getTime())
    });

    if (this.inMemoryReadings.length > this.inMemoryLimit) {
      this.inMemoryReadings.length = this.inMemoryLimit;
    }
  }

  private getInMemoryReadings(source: 'tzone' | 'g1', limit: number) {
    return this.inMemoryReadings
      .filter(
        (reading) =>
          this.isIdentifierForSource(source, reading.imei) &&
          this.isSourceForProtocol(source, reading.protocolType)
      )
      .slice(0, limit);
  }

  private buildMetadata(payload: TzoneReadingPayload): string | null {
    if (payload.source !== 'g1') {
      return payload.rawAscii;
    }

    return JSON.stringify({
      source: payload.source,
      deviceType: payload.deviceType,
      gatewayMac: payload.gatewayMac,
      bleName: payload.bleName,
      rssi: payload.rssi,
      gatewayFree: payload.gatewayFree,
      gatewayLoad: payload.gatewayLoad
    } satisfies PersistedReadingMetadata);
  }

  private parseMetadata(rawAscii: string | null): PersistedReadingMetadata {
    if (rawAscii === null) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawAscii) as PersistedReadingMetadata;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private toG1ReadingEvent(args: {
    rawAscii: string | null;
    receivedAt: Date;
    imei: string | null;
    deviceType: string | null;
    bleName: string | null;
    rssi: number | null;
    gatewayFree: number | null;
    gatewayLoad: number | null;
    rawHex: string;
  }): G1ReadingEvent {
    let parsedRecord: Record<string, unknown> | null = null;

    if (args.rawAscii !== null) {
      try {
        const parsed = JSON.parse(args.rawAscii) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          parsedRecord = parsed as Record<string, unknown>;
        }
      } catch {
        parsedRecord = null;
      }
    }

    const valueAsString = (value: unknown) => (typeof value === 'string' ? value : null);
    const valueAsNumber = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;

    return {
      timestamp: valueAsString(parsedRecord?.timestamp) ?? args.receivedAt.toISOString(),
      type: valueAsString(parsedRecord?.type) ?? args.deviceType,
      mac: valueAsString(parsedRecord?.mac) ?? args.imei,
      bleNo: valueAsNumber(parsedRecord?.bleNo),
      bleName: valueAsString(parsedRecord?.bleName) ?? '',
      rssi: valueAsNumber(parsedRecord?.rssi) ?? args.rssi,
      rawData: valueAsString(parsedRecord?.rawData) ?? args.rawHex,
      gatewayFree: valueAsNumber(parsedRecord?.gatewayFree) ?? args.gatewayFree,
      gatewayLoad: valueAsNumber(parsedRecord?.gatewayLoad) ?? args.gatewayLoad
    };
  }

  private toReadingResponse(
    reading: {
      imei: string | null;
      temperature: number | null;
      humidity: number | null;
      light: number | null;
      battery: number | null;
      rawHex: string;
      packetIndex: number | null;
      receivedAt: Date;
      rawAscii: string | null;
      protocolType: string | null;
    }
  ) {
    const metadata = this.parseMetadata(reading.rawAscii);

    return {
      imei: reading.imei,
      source:
        metadata.source ??
        (reading.protocolType === 'g1-mqtt-json' || reading.protocolType === 'g1-http-json'
          ? 'g1'
          : 'tzone'),
      deviceType: metadata.deviceType ?? null,
      gatewayMac: metadata.gatewayMac ?? null,
      bleName: metadata.bleName ?? null,
      rssi: metadata.rssi ?? null,
      gatewayFree: metadata.gatewayFree ?? null,
      gatewayLoad: metadata.gatewayLoad ?? null,
      temperature: reading.temperature,
      humidity: reading.humidity,
      light: reading.light,
      battery: reading.battery,
      receivedAt: reading.receivedAt.toISOString(),
      rawHex: reading.rawHex,
      packetIndex: reading.packetIndex
    };
  }

  async ingestReading(payload: TzoneReadingPayload) {
    const trustedReading = this.isTrustedDeviceReading(payload);
    this.rememberReading(payload);

    const broadcastPayload = {
      imei: payload.imei,
      source: payload.source,
      deviceType: payload.deviceType,
      gatewayMac: payload.gatewayMac,
      bleName: payload.bleName,
      rssi: payload.rssi,
      gatewayFree: payload.gatewayFree,
      gatewayLoad: payload.gatewayLoad,
      temperature: payload.temperature,
      humidity: payload.humidity,
      light: payload.light,
      battery: payload.battery,
      receivedAt: payload.receivedAt.toISOString(),
      rawHex: payload.rawHex,
      packetIndex: payload.packetIndex
    };

    if (!isDatabaseConfigured || prisma === null) {
      if (trustedReading) {
        if (payload.source === 'g1') {
          tzoneGateway.broadcastG1Reading(
            this.toG1ReadingEvent({
              rawAscii: payload.rawAscii,
              receivedAt: payload.receivedAt,
              imei: payload.imei,
              deviceType: payload.deviceType,
              bleName: payload.bleName,
              rssi: payload.rssi,
              gatewayFree: payload.gatewayFree,
              gatewayLoad: payload.gatewayLoad,
              rawHex: payload.rawHex
            })
          );
        } else {
          tzoneGateway.broadcastTzoneReading(broadcastPayload);
        }
      }

      return {
        device: null,
        reading: {
          ...payload,
          receivedAt: payload.receivedAt
        }
      };
    }

    const device =
      !trustedReading || payload.imei === null
        ? null
        : await prisma.tzoneDevice.upsert({
            where: { imei: payload.imei },
            update: { lastSeenAt: payload.receivedAt },
            create: {
              imei: payload.imei,
              lastSeenAt: payload.receivedAt
            }
          });

    const reading = await prisma.tzoneReading.create({
      data: {
        deviceId: device?.id ?? null,
        imei: payload.imei,
        temperature: payload.temperature,
        humidity: payload.humidity,
        light: payload.light,
        battery: payload.battery,
        rtcTime: payload.rtcTime,
        packetIndex: payload.packetIndex,
        protocolType: payload.protocolType,
        rawHex: payload.rawHex,
        rawAscii: this.buildMetadata(payload),
        receivedAt: payload.receivedAt
      }
    });

    if (trustedReading) {
      if (payload.source === 'g1') {
        tzoneGateway.broadcastG1Reading(
          this.toG1ReadingEvent({
            rawAscii: payload.rawAscii,
            receivedAt: payload.receivedAt,
            imei: payload.imei,
            deviceType: payload.deviceType,
            bleName: payload.bleName,
            rssi: payload.rssi,
            gatewayFree: payload.gatewayFree,
            gatewayLoad: payload.gatewayLoad,
            rawHex: payload.rawHex
          })
        );
      } else {
        tzoneGateway.broadcastTzoneReading(broadcastPayload);
      }
    }

    return { device, reading };
  }

  async getLatestReadings(source: 'tzone' | 'g1', limit = 50) {
    if (!isDatabaseConfigured || prisma === null) {
      return this.getInMemoryReadings(source, limit).map((reading) =>
        this.toReadingResponse({
          imei: reading.imei,
          temperature: reading.temperature,
          humidity: reading.humidity,
          light: reading.light,
          battery: reading.battery,
          rawHex: reading.rawHex,
          packetIndex: reading.packetIndex,
          receivedAt: reading.receivedAt,
          rawAscii: this.buildMetadata(reading),
          protocolType: reading.protocolType
        })
      );
    }

    const readings = await prisma.tzoneReading.findMany({
      orderBy: { receivedAt: 'desc' },
      take: limit * 3
    });

    return readings
      .filter(
        (reading) =>
          this.isIdentifierForSource(source, reading.imei) &&
          this.isSourceForProtocol(source, reading.protocolType)
      )
      .slice(0, limit)
      .map((reading) => this.toReadingResponse(reading));
  }

  async getG1LatestReadings(limit = 50): Promise<G1ReadingEvent[]> {
    if (!isDatabaseConfigured || prisma === null) {
      return this.getInMemoryReadings('g1', limit).map((reading) =>
        this.toG1ReadingEvent({
          rawAscii: reading.rawAscii,
          receivedAt: reading.receivedAt,
          imei: reading.imei,
          deviceType: reading.deviceType,
          bleName: reading.bleName,
          rssi: reading.rssi,
          gatewayFree: reading.gatewayFree,
          gatewayLoad: reading.gatewayLoad,
          rawHex: reading.rawHex
        })
      );
    }

    const readings = await prisma.tzoneReading.findMany({
      orderBy: { receivedAt: 'desc' },
      take: limit * 3
    });

    return readings
      .filter(
        (reading) =>
          this.isIdentifierForSource('g1', reading.imei) &&
          this.isSourceForProtocol('g1', reading.protocolType)
      )
      .slice(0, limit)
      .map((reading) => {
        const metadata = this.parseMetadata(reading.rawAscii);

        return this.toG1ReadingEvent({
          rawAscii: reading.rawAscii,
          receivedAt: reading.receivedAt,
          imei: reading.imei,
          deviceType: metadata.deviceType ?? null,
          bleName: metadata.bleName ?? null,
          rssi: metadata.rssi ?? null,
          gatewayFree: metadata.gatewayFree ?? null,
          gatewayLoad: metadata.gatewayLoad ?? null,
          rawHex: reading.rawHex
        });
      });
  }

  async getDevices(source: 'tzone' | 'g1'): Promise<TzoneDeviceSummary[]> {
    if (!isDatabaseConfigured || prisma === null) {
      const latestByImei = new Map<string, TzoneReadingPayload>();

      for (const reading of this.getInMemoryReadings(source, this.inMemoryLimit)) {
        if (reading.imei === null || latestByImei.has(reading.imei)) {
          continue;
        }

        latestByImei.set(reading.imei, reading);
      }

      return Array.from(latestByImei.values()).map((reading) => {
        const latestReading = this.toReadingResponse({
          imei: reading.imei,
          temperature: reading.temperature,
          humidity: reading.humidity,
          light: reading.light,
          battery: reading.battery,
          rawHex: reading.rawHex,
          packetIndex: reading.packetIndex,
          receivedAt: reading.receivedAt,
          rawAscii: this.buildMetadata(reading),
          protocolType: reading.protocolType
        });

        return {
          imei: reading.imei ?? 'unknown',
          source: latestReading.source,
          deviceType: latestReading.deviceType,
          gatewayMac: latestReading.gatewayMac,
          bleName: latestReading.bleName,
          rssi: latestReading.rssi,
          name: null,
          lastSeenAt: reading.receivedAt.toISOString(),
          isOnline: this.isDeviceOnline(reading.receivedAt),
          onlineStatus: this.isDeviceOnline(reading.receivedAt) ? 'online' : 'offline',
          latestReading
        };
      });
    }

    const devices = await prisma.tzoneDevice.findMany({
      orderBy: { lastSeenAt: 'desc' },
      include: {
        readings: {
          orderBy: { receivedAt: 'desc' },
          take: 1
        }
      }
    });

    return devices
      .filter((device) => this.isIdentifierForSource(source, device.imei))
      .flatMap((device: (typeof devices)[number]) => {
        const latestReadingRecord = device.readings[0];
        if (
          latestReadingRecord === undefined ||
          !this.isSourceForProtocol(source, latestReadingRecord.protocolType)
        ) {
          return [];
        }

        const isOnline = this.isDeviceOnline(device.lastSeenAt);
        const latestReading = this.toReadingResponse(latestReadingRecord);

        return [
          {
            imei: device.imei,
            source: latestReading.source,
            deviceType: latestReading.deviceType ?? null,
            gatewayMac: latestReading.gatewayMac ?? null,
            bleName: latestReading.bleName ?? null,
            rssi: latestReading.rssi ?? null,
            name: device.name,
            lastSeenAt: device.lastSeenAt.toISOString(),
            isOnline,
            onlineStatus: isOnline ? 'online' : 'offline',
            latestReading
          }
        ];
      });
  }

  async getDeviceReadings(source: 'tzone' | 'g1', imei: string, limit = 100) {
    if (!isDatabaseConfigured || prisma === null) {
      return this.getInMemoryReadings(source, this.inMemoryLimit)
        .filter((reading) => reading.imei === imei)
        .slice(0, limit)
        .map((reading) =>
          this.toReadingResponse({
            imei: reading.imei,
            temperature: reading.temperature,
            humidity: reading.humidity,
            light: reading.light,
            battery: reading.battery,
            rawHex: reading.rawHex,
            packetIndex: reading.packetIndex,
            receivedAt: reading.receivedAt,
            rawAscii: this.buildMetadata(reading),
            protocolType: reading.protocolType
          })
        );
    }

    const readings = await prisma.tzoneReading.findMany({
      where: { imei },
      orderBy: { receivedAt: 'desc' },
      take: limit
    });

    return readings
      .filter(
        (reading) =>
          this.isIdentifierForSource(source, reading.imei) &&
          this.isSourceForProtocol(source, reading.protocolType)
      )
      .map((reading) => this.toReadingResponse(reading));
  }
}

export const tzoneService = new TzoneService();
