import type { Server as SocketIOServer } from 'socket.io';

export interface TzoneReadingEvent {
  imei: string | null;
  temperature: number | null;
  humidity: number | null;
  light: number | null;
  battery: number | null;
  receivedAt: string;
  rawHex: string;
  packetIndex: number | null;
}

export class TzoneGateway {
  private io: SocketIOServer | null = null;

  attach(io: SocketIOServer): void {
    this.io = io;
  }

  broadcastReading(payload: TzoneReadingEvent): void {
    this.io?.emit('tzone:reading', payload);
  }
}

export const tzoneGateway = new TzoneGateway();
