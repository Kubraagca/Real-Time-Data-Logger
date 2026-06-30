import { TzoneReadingPayload } from '../tzone/tzone.types';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDeviceType(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) {
    return null;
  }

  return raw.toLowerCase() === 'gateway' ? 'Gateway' : raw;
}

function normalizeMac(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) {
    return null;
  }

  const normalized = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return normalized.length === 12 ? normalized : null;
}

function toRawHex(record: JsonRecord): string {
  const rawData = asString(record.rawData);
  if (rawData !== null) {
    return rawData.toUpperCase();
  }

  return Buffer.from(JSON.stringify(record), 'utf8').toString('hex').toUpperCase();
}

function toReceivedAt(value: unknown, fallback: Date): Date {
  const raw = asString(value);
  if (raw === null) {
    return fallback;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toLightValue(deviceType: string | null, record: JsonRecord): number | null {
  if (deviceType !== 'S4') {
    return null;
  }

  const triggered = record.triggered === true ? 1 : 0;
  return triggered;
}

function parseG1JsonRecords(
  parsed: unknown,
  receivedAt: Date,
  remoteAddress: string,
  remotePort: number,
  protocolType: 'g1-mqtt-json' | 'g1-http-json'
): TzoneReadingPayload[] {
  const transportLabel = protocolType === 'g1-http-json' ? 'http' : 'mqtt';

  const records = Array.isArray(parsed) ? parsed : [parsed];

  return records
    .filter(isRecord)
    .map((record) => {
      const deviceType = normalizeDeviceType(record.type);
      const identifier = normalizeMac(record.mac);

      return {
        imei: identifier,
        deviceId: identifier,
        source: 'g1' as const,
        deviceType,
        gatewayMac: deviceType === 'Gateway' ? identifier : null,
        bleName: asString(record.bleName),
        rssi: asNumber(record.rssi),
        gatewayFree: asNumber(record.gatewayFree),
        gatewayLoad: asNumber(record.gatewayLoad),
        temperature: asNumber(record.temperature),
        humidity: asNumber(record.humidity),
        light: toLightValue(deviceType, record),
        battery: asNumber(record.battery),
        rtcTime: null,
        packetIndex: null,
        rawHex: toRawHex(record),
        rawAscii: JSON.stringify(record),
        protocolType,
        receivedAt: toReceivedAt(record.timestamp, receivedAt),
        remoteAddress,
        remotePort
      };
    })
    .filter((reading) => reading.imei !== null);
}

export function parseG1MqttPayload(
  payload: Buffer,
  receivedAt = new Date()
): TzoneReadingPayload[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    console.warn('[G1:MQTT] Invalid JSON payload received.', error);
    return [];
  }

  return parseG1JsonRecords(parsed, receivedAt, 'mqtt', 0, 'g1-mqtt-json');
}

export function parseG1HttpPayload(
  payload: unknown,
  receivedAt = new Date(),
  remoteAddress = 'http',
  remotePort = 0
): TzoneReadingPayload[] {
  if (
    payload === undefined ||
    payload === null ||
    payload === '' ||
    (typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0)
  ) {
    return [];
  }

  let parsed: unknown = payload;

  if (Buffer.isBuffer(payload)) {
    const text = payload.toString('utf8').trim();
    if (!text) {
      return [];
    }

    parsed = JSON.parse(text);
  } else if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) {
      return [];
    }

    parsed = JSON.parse(text);
  }

  return parseG1JsonRecords(parsed, receivedAt, remoteAddress, remotePort, 'g1-http-json');
}
