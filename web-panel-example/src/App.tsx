import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type TzoneReadingEvent = {
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
};

type TzoneDeviceSummary = {
  imei: string;
  source?: 'tzone' | 'g1';
  deviceType: string | null;
  gatewayMac: string | null;
  bleName: string | null;
  rssi: number | null;
  name: string | null;
  lastSeenAt: string;
  isOnline: boolean;
  onlineStatus: 'online' | 'offline';
  latestReading: {
    source?: 'tzone' | 'g1';
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
};

const API_BASE_URL = 'https://real-time-data-logger-production.up.railway.app';

function formatMetric(value: number | null, suffix: string) {
  return value === null ? '-' : `${value}${suffix}`;
}

function formatDeviceLabel(row: TzoneDeviceSummary) {
  return row.bleName ?? row.imei ?? '-';
}

function formatDeviceType(row: TzoneDeviceSummary) {
  return row.latestReading?.deviceType ?? row.deviceType ?? row.latestReading?.source?.toUpperCase() ?? row.source?.toUpperCase() ?? 'UNKNOWN';
}

function formatLastSeen(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isGatewayRow(row: TzoneDeviceSummary) {
  return (row.latestReading?.deviceType ?? row.deviceType) === 'Gateway';
}

function DeviceTable({ rows }: { rows: TzoneDeviceSummary[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Cihaz</th>
          <th>Tip</th>
          <th>Sicaklik</th>
          <th>Nem</th>
          <th>Durum</th>
          <th>Batarya</th>
          <th>Gateway</th>
          <th>RSSI</th>
          <th>Son gorulme</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.imei}-${row.latestReading?.receivedAt ?? row.lastSeenAt}-${index}`}>
            <td>
              <strong>{formatDeviceLabel(row)}</strong>
              <div>{row.imei ?? '-'}</div>
            </td>
            <td>{formatDeviceType(row)}</td>
            <td>{formatMetric(row.latestReading?.temperature ?? null, ' C')}</td>
            <td>{formatMetric(row.latestReading?.humidity ?? null, ' %')}</td>
            <td>{row.isOnline ? 'Online' : 'Offline'}</td>
            <td>{formatMetric(row.latestReading?.battery ?? null, ' %')}</td>
            <td>{row.latestReading?.gatewayMac ?? row.gatewayMac ?? '-'}</td>
            <td>{formatMetric(row.latestReading?.rssi ?? row.rssi ?? null, ' dBm')}</td>
            <td>{formatLastSeen(row.lastSeenAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function App() {
  const [rows, setRows] = useState<TzoneDeviceSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const gatewayRows = rows.filter(isGatewayRow);
  const sensorRows = rows.filter((row) => !isGatewayRow(row));

  useEffect(() => {
    let socket: Socket | null = null;

    const loadInitialData = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/tzone/devices`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as unknown;

        if (!Array.isArray(data)) {
          throw new Error('API beklenen dizi formatinda donmedi.');
        }

        setRows(data as TzoneDeviceSummary[]);
        setErrorMessage(null);
      } catch (error) {
        console.error('Failed to load initial device list', error);
        setRows([]);
        setErrorMessage(
          error instanceof Error ? error.message : 'Cihaz listesi yuklenemedi.'
        );
      }
    };

    void loadInitialData();

    socket = io(API_BASE_URL, {
      transports: ['polling', 'websocket']
    });

    socket.on('tzone:reading', (reading: TzoneReadingEvent) => {
      if (!reading.imei) {
        return;
      }

      setErrorMessage(null);

      setRows((current) => {
        const imei = reading.imei ?? '';
        const nextRow: TzoneDeviceSummary = {
          imei,
          source: reading.source,
          deviceType: reading.deviceType,
          gatewayMac: reading.gatewayMac,
          bleName: reading.bleName,
          rssi: reading.rssi,
          name: null,
          lastSeenAt: reading.receivedAt,
          isOnline: true,
          onlineStatus: 'online',
          latestReading: {
            source: reading.source,
            deviceType: reading.deviceType,
            gatewayMac: reading.gatewayMac,
            bleName: reading.bleName,
            rssi: reading.rssi,
            gatewayFree: reading.gatewayFree,
            gatewayLoad: reading.gatewayLoad,
            temperature: reading.temperature,
            humidity: reading.humidity,
            light: reading.light,
            battery: reading.battery,
            receivedAt: reading.receivedAt,
            rawHex: reading.rawHex,
            packetIndex: reading.packetIndex
          }
        };

        const filtered = current.filter((row) => row.imei !== imei);
        return [nextRow, ...filtered];
      });
    });

    return () => {
      socket?.disconnect();
    };
  }, []);

  return (
    <main className="page-shell">
      <section className="panel">
        <header className="panel-header">
          <p className="eyebrow">Live telemetry</p>
          <h1>Gateway ve Isi Sensorleri</h1>
          <p className="lede">
            Gateway HTTP POST akisi ile gelen gercek cihaz verileri ayri alanlarda gosterilir.
          </p>
        </header>

        <div className="table-wrap">
          {errorMessage ? <p className="status-banner">{errorMessage}</p> : null}
          <section className="data-group">
            <div className="group-header">
              <h2>Isi Sensorleri</h2>
              <span>{sensorRows.length} cihaz</span>
            </div>
            {sensorRows.length > 0 ? <DeviceTable rows={sensorRows} /> : <p className="empty-inline">Henuz sensor verisi yok.</p>}
          </section>
          <section className="data-group">
            <div className="group-header">
              <h2>Gateway Cihazlari</h2>
              <span>{gatewayRows.length} cihaz</span>
            </div>
            {gatewayRows.length > 0 ? <DeviceTable rows={gatewayRows} /> : <p className="empty-inline">Henuz gateway verisi yok.</p>}
          </section>
        </div>
      </section>
    </main>
  );
}
