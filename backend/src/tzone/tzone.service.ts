import { env } from '../config/env';
import { isDatabaseConfigured, prisma } from '../config/prisma';
import { tzoneGateway } from './tzone.gateway';
import { TzoneDeviceSummary, TzoneReadingPayload } from './tzone.types';

export class TzoneService {
  private readonly onlineWindowMs = env.TZONE_ONLINE_WINDOW_MINUTES * 60 * 1000;

  private isDeviceOnline(lastSeenAt: Date) {
    return Date.now() - lastSeenAt.getTime() <= this.onlineWindowMs;
  }

  private isCanonicalImei(imei: string | null) {
    return imei !== null && /^\d{15}$/.test(imei);
  }

  private isTrustedDeviceReading(payload: TzoneReadingPayload) {
    return (
      payload.protocolType === 'binary' &&
      this.isCanonicalImei(payload.imei) &&
      payload.rawHex.startsWith('545A')
    );
  }

  async ingestReading(payload: TzoneReadingPayload) {
    const trustedReading = this.isTrustedDeviceReading(payload);

    const broadcastPayload = {
      imei: payload.imei,
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
        rawAscii: payload.rawAscii,
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

    return readings.filter((reading) => this.isCanonicalImei(reading.imei)).slice(0, limit);
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

      return {
        imei: device.imei,
        name: device.name,
        lastSeenAt: device.lastSeenAt.toISOString(),
        isOnline,
        onlineStatus: isOnline ? 'online' : 'offline',
        latestReading: device.readings[0]
          ? {
              temperature: device.readings[0].temperature,
              humidity: device.readings[0].humidity,
              light: device.readings[0].light,
              battery: device.readings[0].battery,
              receivedAt: device.readings[0].receivedAt.toISOString(),
              rawHex: device.readings[0].rawHex,
              packetIndex: device.readings[0].packetIndex
            }
          : null
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

    return readings.filter((reading) => this.isCanonicalImei(reading.imei));
  }
}

export const tzoneService = new TzoneService();
