import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type G1ReadingEvent = {
  timestamp: string;
  type: string | null;
  mac: string | null;
  bleNo?: number | null;
  bleName?: string;
  rssi?: number | null;
  rawData?: string | null;
  gatewayFree?: number | null;
  gatewayLoad?: number | null;
};

type DeviceTab = 'beacon' | 'gateway';

const API_BASE_URL = 'https://real-time-data-logger-production.up.railway.app';

function normalizeType(value: string | null | undefined) {
  if (!value) {
    return 'Unknown';
  }

  const trimmed = value.trim();
  return trimmed || 'Unknown';
}

function isGatewayReading(reading: G1ReadingEvent) {
  return normalizeType(reading.type).toLowerCase() === 'gateway';
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatNumber(value: number | null | undefined, suffix = '') {
  return typeof value === 'number' ? `${value}${suffix}` : '-';
}

function ReadingTable({ rows }: { rows: G1ReadingEvent[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Type</th>
          <th>MAC</th>
          <th>BLE No</th>
          <th>BLE Name</th>
          <th>RSSI</th>
          <th>Gateway Free</th>
          <th>Gateway Load</th>
          <th>Raw Data</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.mac ?? 'unknown'}-${row.timestamp}-${index}`}>
            <td>{formatTimestamp(row.timestamp)}</td>
            <td>{normalizeType(row.type)}</td>
            <td>{row.mac ?? '-'}</td>
            <td>{formatNumber(row.bleNo)}</td>
            <td>{row.bleName && row.bleName.trim() ? row.bleName : '-'}</td>
            <td>{formatNumber(row.rssi, ' dBm')}</td>
            <td>{formatNumber(row.gatewayFree, ' MB')}</td>
            <td>{formatNumber(row.gatewayLoad)}</td>
            <td>{row.rawData ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function App() {
  const [rows, setRows] = useState<G1ReadingEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DeviceTab>('beacon');

  const gatewayRows = rows.filter(isGatewayReading);
  const beaconRows = rows.filter((row) => !isGatewayReading(row));
  const visibleRows = activeTab === 'beacon' ? beaconRows : gatewayRows;
  const activeTitle = activeTab === 'beacon' ? 'Beacon Kayitlari' : 'Gateway Kayitlari';
  const activeEmptyMessage =
    activeTab === 'beacon' ? 'Henuz beacon verisi yok.' : 'Henuz gateway verisi yok.';

  useEffect(() => {
    let socket: Socket | null = null;

    const loadInitialData = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/g1/readings/latest?limit=100`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as unknown;

        if (!Array.isArray(data)) {
          throw new Error('API beklenen dizi formatinda donmedi.');
        }

        setRows(data as G1ReadingEvent[]);
        setErrorMessage(null);
      } catch (error) {
        console.error('Failed to load G1 readings', error);
        setRows([]);
        setErrorMessage(
          error instanceof Error ? error.message : 'Gateway verileri yuklenemedi.'
        );
      }
    };

    void loadInitialData();

    socket = io(API_BASE_URL, {
      transports: ['polling', 'websocket']
    });

    socket.on('g1:reading', (reading: G1ReadingEvent) => {
      setErrorMessage(null);
      setRows((current) => [reading, ...current].slice(0, 100));
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
          <h1>G1 Gateway Kayitlari</h1>
          <p className="lede">
            Gateway cihazindan gelen JSON-LONG kayitlari, geldigi formata yakin sekilde burada listelenir.
          </p>
        </header>

        <div className="table-wrap">
          {errorMessage ? <p className="status-banner">{errorMessage}</p> : null}
          <div className="tab-list" role="tablist" aria-label="G1 cihaz kategorileri">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'beacon'}
              className={`tab-button${activeTab === 'beacon' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('beacon')}
            >
              <span>Beacon Kayitlari</span>
              <strong>{beaconRows.length}</strong>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'gateway'}
              className={`tab-button${activeTab === 'gateway' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('gateway')}
            >
              <span>Gateway Kayitlari</span>
              <strong>{gatewayRows.length}</strong>
            </button>
          </div>
          <section className="data-group">
            <div className="group-header">
              <h2>{activeTitle}</h2>
              <span>{visibleRows.length} kayit</span>
            </div>
            {visibleRows.length > 0 ? (
              <ReadingTable rows={visibleRows} />
            ) : (
              <p className="empty-inline">{activeEmptyMessage}</p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
