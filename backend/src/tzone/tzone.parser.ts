import { ParsedTzonePacket, TzoneProtocolType, TzoneRawLog } from './tzone.types';

const PRINTABLE_ASCII = /^[\x09\x0a\x0d\x20-\x7e]+$/;
const TZONE_START = 'TZ';
const BASIC_DATA_MESSAGE_TYPE = 0x2424;
const TT18_4G_M_HARDWARE_TYPE = 0x0407;
const TT18_4G_S_HARDWARE_TYPE = 0x0409;
const PACKET_STOP_SYMBOL = 0x0d0a;

function toHex(buffer: Buffer): string {
  return buffer.toString('hex').toUpperCase();
}

function toAsciiPreview(buffer: Buffer): string {
  return Array.from(buffer)
    .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
    .join('');
}

function guessProtocolType(buffer: Buffer): TzoneProtocolType {
  if (buffer.length === 0) {
    return 'unknown';
  }

  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === TZONE_START) {
    return 'binary';
  }

  const ascii = buffer.toString('utf8');
  const printableRatio =
    ascii.length === 0
      ? 0
      : ascii.split('').filter((char) => PRINTABLE_ASCII.test(char)).length / ascii.length;

  return printableRatio > 0.85 ? 'ascii' : 'binary';
}

function looksLikeTlsClientHello(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0x16 && buffer[1] === 0x03;
}

function readUInt16BE(buffer: Buffer, offset: number): number | null {
  if (offset + 2 > buffer.length) {
    return null;
  }

  return buffer.readUInt16BE(offset);
}

function decodePackedImei(buffer: Buffer, offset: number): string | null {
  if (offset + 8 > buffer.length) {
    return null;
  }

  const imei = buffer.subarray(offset, offset + 8).toString('hex').slice(1);
  return imei.length === 15 ? imei : null;
}

function hasValidTzoneEnvelope(buffer: Buffer): boolean {
  if (buffer.length < 12) {
    return false;
  }

  if (buffer.subarray(0, 2).toString('ascii') !== TZONE_START) {
    return false;
  }

  const stopSymbol = readUInt16BE(buffer, buffer.length - 2);
  return stopSymbol === PACKET_STOP_SYMBOL;
}

function getPacketLength(buffer: Buffer): number | null {
  return readUInt16BE(buffer, 2);
}

function decodeRtcDate(buffer: Buffer, offset: number): Date | null {
  if (offset + 6 > buffer.length) {
    return null;
  }

  const year = 2000 + buffer[offset];
  const month = buffer[offset + 1];
  const day = buffer[offset + 2];
  const hour = buffer[offset + 3];
  const minute = buffer[offset + 4];
  const second = buffer[offset + 5];

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

function decodeBatteryVoltage(rawValue: number | null): number | null {
  if (rawValue === null) {
    return null;
  }

  return Number.parseFloat((rawValue / 100).toFixed(2));
}

function decodeTemperature(rawValue: number | null): number | null {
  if (rawValue === null || rawValue === 0x8000) {
    return null;
  }

  const sensorAbnormal = (rawValue & 0x8000) !== 0;
  if (sensorAbnormal) {
    return null;
  }

  const isNegative = (rawValue & 0x4000) !== 0;
  const magnitude = rawValue & 0x3fff;
  const temperature = magnitude / 10;

  return Number.parseFloat((isNegative ? -temperature : temperature).toFixed(1));
}

function decodeHumidity(rawValue: number | null): number | null {
  if (rawValue === null || rawValue === 0xffff) {
    return null;
  }

  const sensorAbnormal = (rawValue & 0x8000) !== 0;
  if (sensorAbnormal) {
    return null;
  }

  return Number.parseFloat(((rawValue & 0x7fff) / 10).toFixed(1));
}

function decodeLight(rawValue: number | null): number | null {
  if (rawValue === null) {
    return null;
  }

  return rawValue & 0x01;
}

function parseAsciiPacket(ascii: string, receivedAt: Date, rawHex: string): ParsedTzonePacket {
  return {
    imei: null,
    deviceId: null,
    source: 'tzone',
    deviceType: null,
    gatewayMac: null,
    bleName: null,
    rssi: null,
    gatewayFree: null,
    gatewayLoad: null,
    temperature: null,
    humidity: null,
    light: null,
    battery: null,
    rtcTime: null,
    packetIndex: null,
    rawHex,
    rawAscii: ascii,
    protocolType: 'ascii',
    receivedAt
  };
}

function parseBinaryPacket(buffer: Buffer, receivedAt: Date, rawHex: string): ParsedTzonePacket {
  if (looksLikeTlsClientHello(buffer) || !hasValidTzoneEnvelope(buffer)) {
    return {
      imei: null,
      deviceId: null,
      source: 'tzone',
      deviceType: null,
      gatewayMac: null,
      bleName: null,
      rssi: null,
      gatewayFree: null,
      gatewayLoad: null,
      temperature: null,
      humidity: null,
      light: null,
      battery: null,
      rtcTime: null,
      packetIndex: null,
      rawHex,
      rawAscii: toAsciiPreview(buffer),
      protocolType: 'unknown',
      receivedAt
    };
  }

  const packetLength = getPacketLength(buffer);
  const messageType = readUInt16BE(buffer, 4);
  const hardwareType = readUInt16BE(buffer, 6);
  const imei = decodePackedImei(buffer, 12);
  const rtcTime = decodeRtcDate(buffer, 20);

  if (packetLength !== null && packetLength + 6 !== buffer.length) {
    return {
      imei,
      deviceId: imei,
      source: 'tzone',
      deviceType: null,
      gatewayMac: null,
      bleName: null,
      rssi: null,
      gatewayFree: null,
      gatewayLoad: null,
      temperature: null,
      humidity: null,
      light: null,
      battery: null,
      rtcTime,
      packetIndex: null,
      rawHex,
      rawAscii: toAsciiPreview(buffer),
      protocolType: 'binary',
      receivedAt
    };
  }

  if (
    messageType !== BASIC_DATA_MESSAGE_TYPE ||
    (hardwareType !== TT18_4G_M_HARDWARE_TYPE && hardwareType !== TT18_4G_S_HARDWARE_TYPE)
  ) {
    return {
      imei,
      deviceId: imei,
      source: 'tzone',
      deviceType: null,
      gatewayMac: null,
      bleName: null,
      rssi: null,
      gatewayFree: null,
      gatewayLoad: null,
      temperature: null,
      humidity: null,
      light: null,
      battery: null,
      rtcTime,
      packetIndex: null,
      rawHex,
      rawAscii: toAsciiPreview(buffer),
      protocolType: 'binary',
      receivedAt
    };
  }

  let cursor = 26;

  const gpsLength = readUInt16BE(buffer, cursor);
  if (gpsLength !== null) {
    cursor += 2 + gpsLength;
  }

  const lbsLength = readUInt16BE(buffer, cursor);
  if (lbsLength !== null) {
    cursor += 2 + lbsLength;
  }

  const statusLength = readUInt16BE(buffer, cursor);
  let battery: number | null = null;
  let temperature: number | null = null;
  let humidity: number | null = null;
  let light: number | null = null;

  if (statusLength !== null) {
    cursor += 2;
    const statusStart = cursor;

    if (statusLength >= 11 && statusStart + statusLength <= buffer.length) {
      battery = decodeBatteryVoltage(readUInt16BE(buffer, statusStart + 4));
      temperature = decodeTemperature(readUInt16BE(buffer, statusStart + 6));
      humidity = decodeHumidity(readUInt16BE(buffer, statusStart + 8));
      light = decodeLight(buffer[statusStart + 10] ?? null);
    }

    cursor = statusStart + statusLength;
  }

  const packetIndex = readUInt16BE(buffer, buffer.length - 6);

  return {
    imei,
    deviceId: imei,
    source: 'tzone',
    deviceType: null,
    gatewayMac: null,
    bleName: null,
    rssi: null,
    gatewayFree: null,
    gatewayLoad: null,
    temperature,
    humidity,
    light,
    battery,
    rtcTime,
    packetIndex,
    rawHex,
    rawAscii: toAsciiPreview(buffer),
    protocolType: 'binary',
    receivedAt
  };
}

export function buildTzoneRawLog(
  buffer: Buffer,
  remoteAddress: string,
  remotePort: number,
  receivedAt: Date
): TzoneRawLog {
  return {
    remoteAddress,
    remotePort,
    receivedAt: receivedAt.toISOString(),
    rawHex: toHex(buffer),
    asciiPreview: toAsciiPreview(buffer)
  };
}

export function parseTzonePacket(buffer: Buffer, receivedAt = new Date()): ParsedTzonePacket {
  const rawHex = toHex(buffer);
  const protocolType = guessProtocolType(buffer);

  try {
    if (protocolType === 'ascii') {
      return parseAsciiPacket(buffer.toString('utf8').trim(), receivedAt, rawHex);
    }

    if (protocolType === 'binary') {
      return parseBinaryPacket(buffer, receivedAt, rawHex);
    }
  } catch (error) {
    console.warn('Tzone packet parse failed, falling back to raw persistence.', error);
  }

  return {
    imei: null,
    deviceId: null,
    source: 'tzone',
    deviceType: null,
    gatewayMac: null,
    bleName: null,
    rssi: null,
    gatewayFree: null,
    gatewayLoad: null,
    temperature: null,
    humidity: null,
    light: null,
    battery: null,
    rtcTime: null,
    packetIndex: null,
    rawHex,
    rawAscii: toAsciiPreview(buffer),
    protocolType,
    receivedAt
  };
}

export function buildTzoneAck(packetIndex: number): Buffer {
  return Buffer.from(`@ACK,${packetIndex}#\r\n`, 'utf8');
}
