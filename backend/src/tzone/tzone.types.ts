export type TzoneProtocolType =
  | 'ascii'
  | 'binary'
  | 'unknown'
  | 'g1-mqtt-json'
  | 'g1-http-json';

export interface TzoneRawLog {
  remoteAddress: string;
  remotePort: number;
  receivedAt: string;
  rawHex: string;
  asciiPreview: string;
}

export interface ParsedTzonePacket {
  imei: string | null;
  deviceId: string | null;
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
  rtcTime: Date | null;
  packetIndex: number | null;
  rawHex: string;
  rawAscii: string | null;
  protocolType: TzoneProtocolType;
  receivedAt: Date;
}

export interface TzoneReadingPayload extends ParsedTzonePacket {
  remoteAddress: string;
  remotePort: number;
}

export interface TzoneDeviceSummary {
  imei: string;
  source: 'tzone' | 'g1';
  deviceType: string | null;
  gatewayMac: string | null;
  bleName: string | null;
  rssi: number | null;
  name: string | null;
  lastSeenAt: string;
  isOnline: boolean;
  onlineStatus: 'online' | 'offline';
  latestReading: {
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
  } | null;
}
