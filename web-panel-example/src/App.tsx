import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type TzoneReadingEvent = {
  imei: string | null;
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
  name: string | null;
  lastSeenAt: string;
  latestReading: {
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

export function App() {
  const [rows, setRows] = useState<TzoneDeviceSummary[]>([]);

  useEffect(() => {
    let socket: Socket | null = null;

    const loadInitialData = async () => {
      const response = await fetch(`${API_BASE_URL}/api/tzone/devices`);
      const data = (await response.json()) as TzoneDeviceSummary[];
      setRows(data);
    };

    void loadInitialData();

    socket = io(API_BASE_URL, {
      transports: ['polling', 'websocket']
    });

    socket.on('tzone:reading', (reading: TzoneReadingEvent) => {
      if (!reading.imei) {
        return;
      }

      setRows((current) => {
        const imei = reading.imei as string;
        const nextRow: TzoneDeviceSummary = {
          imei,
          name: null,
          lastSeenAt: reading.receivedAt,
          latestReading: {
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
          <h1>Tzone TT18-4G-M Monitor</h1>
          <p className="lede">
            Cihazdan gelen son sicaklik ve nem verileri Socket.IO ile tabloya anlik yansir.
          </p>
        </header>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>IMEI</th>
                <th>Sicaklik</th>
                <th>Nem</th>
                <th>Batarya</th>
                <th>Isik</th>
                <th>Son gorulme</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.imei}-${row.latestReading?.receivedAt ?? row.lastSeenAt}-${index}`}>
                  <td>{row.imei}</td>
                  <td>{formatMetric(row.latestReading?.temperature ?? null, ' C')}</td>
                  <td>{formatMetric(row.latestReading?.humidity ?? null, ' %')}</td>
                  <td>{formatMetric(row.latestReading?.battery ?? null, ' V')}</td>
                  <td>
                    {row.latestReading === null
                      ? '-'
                      : row.latestReading.light === 1
                        ? 'Dark'
                        : 'Bright'}
                  </td>
                  <td>{new Date(row.lastSeenAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
