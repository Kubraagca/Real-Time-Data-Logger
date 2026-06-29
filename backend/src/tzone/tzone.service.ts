import { env } from '../config/env';
import { isDatabaseConfigured, prisma } from '../config/prisma';
import { tzoneGateway } from './tzone.gateway';
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

  private isDeviceOnline(lastSeenAt: Date) {
    return Date.now() - lastSeenAt.getTime() <= this.onlineWindowMs;
  }

  private isCanonicalImei(imei: string | null) {
    return imei !== null && (this.isCanonicalTzoneImei(imei) || this.isCanonicalG1Mac(imei));
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

    return (
      payload.protocolType === 'binary' &&
      this.isCanonicalTzoneImei(payload.imei) &&
      payload.rawHex.startsWith('545A')
    );
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
      source: metadata.source ?? (reading.protocolType === 'g1-mqtt-json' ? 'g1' : 'tzone'),
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
        tzoneGateway.broadcastReading(broadcastPayload);
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
      tzoneGateway.broadcastReading(broadcastPayload);
    }

    return { device, reading };
  }

  async getLatestReadings(limit = 50) {
    if (!isDatabaseConfigured || prisma === null) {
      return [];
    }

    const readings = await prisma.tzoneReading.findMany({
      orderBy: { receivedAt: 'desc' },
      take: limit * 3
    });

    return readings
      .filter((reading) => this.isCanonicalImei(reading.imei))
      .slice(0, limit)
      .map((reading) => this.toReadingResponse(reading));
  }

  async getDevices(): Promise<TzoneDeviceSummary[]> {
    if (!isDatabaseConfigured || prisma === null) {
      return [];
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
      .filter((device) => this.isCanonicalImei(device.imei))
      .map((device: (typeof devices)[number]) => {
      const isOnline = this.isDeviceOnline(device.lastSeenAt);
      const latestReading = device.readings[0] ? this.toReadingResponse(device.readings[0]) : null;

      return {
        imei: device.imei,
        source: latestReading?.source ?? 'tzone',
        deviceType: latestReading?.deviceType ?? null,
        gatewayMac: latestReading?.gatewayMac ?? null,
        bleName: latestReading?.bleName ?? null,
        rssi: latestReading?.rssi ?? null,
        name: device.name,
        lastSeenAt: device.lastSeenAt.toISOString(),
        isOnline,
        onlineStatus: isOnline ? 'online' : 'offline',
        latestReading
      };
    });
  }

  async getDeviceReadings(imei: string, limit = 100) {
    if (!isDatabaseConfigured || prisma === null) {
      return [];
    }

    const readings = await prisma.tzoneReading.findMany({
      where: { imei },
      orderBy: { receivedAt: 'desc' },
      take: limit
    });

    return readings
      .filter((reading) => this.isCanonicalImei(reading.imei))
      .map((reading) => this.toReadingResponse(reading));
  }
}

export const tzoneService = new TzoneService();
