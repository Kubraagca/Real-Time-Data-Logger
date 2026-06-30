import type { Server as SocketIOServer } from 'socket.io';

export interface TzoneReadingEvent {
  imei: string | null;
  source: 'tzone' | 'g1';
  deviceType: string | null;
  gatewayMac: string | null;
  bleName: string | null;
  rssi: number | null;
  gatewayFree: number | null;
  gatewayLoad: number | null;
  temperature: number | null;
  humidity: number | null;
  light: number | null;
  battery: number | null;
  receivedAt: string;
  rawHex: string;
  packetIndex: number | null;
}

export interface G1ReadingEvent {
  timestamp: string;
  type: string | null;
  mac: string | null;
  bleNo?: number | null;
  bleName?: string;
  rssi?: number | null;
  rawData?: string | null;
  gatewayFree?: number | null;
  gatewayLoad?: number | null;
}

export class TzoneGateway {
  private io: SocketIOServer | null = null;

  attach(io: SocketIOServer): void {
    this.io = io;
  }

  broadcastTzoneReading(payload: TzoneReadingEvent): void {
    this.io?.emit('tzone:reading', payload);
  }

  broadcastG1Reading(payload: G1ReadingEvent): void {
    this.io?.emit('g1:reading', payload);
  }
}

export const tzoneGateway = new TzoneGateway();
