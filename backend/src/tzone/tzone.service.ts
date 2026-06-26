import { isDatabaseConfigured, prisma } from '../config/prisma';
import { tzoneGateway } from './tzone.gateway';
import { TzoneDeviceSummary, TzoneReadingPayload } from './tzone.types';

export class TzoneService {
  async ingestReading(payload: TzoneReadingPayload) {
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
      tzoneGateway.broadcastReading(broadcastPayload);

      return {
        device: null,
        reading: {
          ...payload,
          receivedAt: payload.receivedAt
        }
      };
    }

    const device =
      payload.imei === null
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

    tzoneGateway.broadcastReading(broadcastPayload);

    return { device, reading };
  }

  async getLatestReadings(limit = 50) {
    if (!isDatabaseConfigured || prisma === null) {
      return [];
    }

    return prisma.tzoneReading.findMany({
      orderBy: { receivedAt: 'desc' },
      take: limit
    });
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

    return devices.map((device: (typeof devices)[number]) => ({
      imei: device.imei,
      name: device.name,
      lastSeenAt: device.lastSeenAt.toISOString(),
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
    }));
  }

  async getDeviceReadings(imei: string, limit = 100) {
    if (!isDatabaseConfigured || prisma === null) {
      return [];
    }

    return prisma.tzoneReading.findMany({
      where: { imei },
      orderBy: { receivedAt: 'desc' },
      take: limit
    });
  }
}

export const tzoneService = new TzoneService();
