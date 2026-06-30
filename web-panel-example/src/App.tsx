import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type TzoneReadingEvent = {
  imei: string | null;
  source: 'tzone';
  temperature: number | null;
  humidity: number | null;
  light: number | null;
  battery: number | null;
  receivedAt: string;
  rawHex: string;
  packetIndex: number | null;
};

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

type SourceTab = 'tzone' | 'g1';

const API_BASE_URL = 'https://real-time-data-logger-production.up.railway.app';

function normalizeG1Type(value: string | null | undefined) {
  if (!value) {
    return 'Unknown';
  }

  const trimmed = value.trim();
  return trimmed || 'Unknown';
}

function isGatewayReading(reading: G1ReadingEvent) {
  return normalizeG1Type(reading.type).toLowerCase() === 'gateway';
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatNumber(value: number | null | undefined, suffix = '') {
  return typeof value === 'number' ? `${value}${suffix}` : '-';
}

function TzoneTable({ rows }: { rows: TzoneReadingEvent[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>IMEI</th>
          <th>Sicaklik</th>
          <th>Nem</th>
          <th>Isik</th>
          <th>Batarya</th>
          <th>Paket</th>
          <th>Raw Hex</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.imei ?? 'unknown'}-${row.receivedAt}-${index}`}>
            <td>{formatTimestamp(row.receivedAt)}</td>
            <td>{row.imei ?? '-'}</td>
            <td>{formatNumber(row.temperature, ' C')}</td>
            <td>{formatNumber(row.humidity, ' %')}</td>
            <td>{formatNumber(row.light)}</td>
            <td>{formatNumber(row.battery)}</td>
            <td>{formatNumber(row.packetIndex)}</td>
            <td>{row.rawHex || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function G1Table({ rows }: { rows: G1ReadingEvent[] }) {
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
            <td>{normalizeG1Type(row.type)}</td>
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
  const [tzoneRows, setTzoneRows] = useState<TzoneReadingEvent[]>([]);
  const [g1Rows, setG1Rows] = useState<G1ReadingEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeSourceTab, setActiveSourceTab] = useState<SourceTab>('tzone');

  const gatewayRows = g1Rows.filter(isGatewayReading);
  const beaconRows = g1Rows.filter((row) => !isGatewayReading(row));

  useEffect(() => {
    let socket: Socket | null = null;

    const loadInitialData = async () => {
      try {
        const [tzoneResponse, g1Response] = await Promise.all([
          fetch(`${API_BASE_URL}/api/tzone/readings/latest?limit=100`),
          fetch(`${API_BASE_URL}/api/g1/readings/latest?limit=100`)
        ]);

        if (!tzoneResponse.ok) {
          throw new Error(`TZONE HTTP ${tzoneResponse.status}`);
        }

        if (!g1Response.ok) {
          throw new Error(`G1 HTTP ${g1Response.status}`);
        }

        const [tzoneData, g1Data] = (await Promise.all([
          tzoneResponse.json(),
          g1Response.json()
        ])) as [unknown, unknown];

        if (!Array.isArray(tzoneData) || !Array.isArray(g1Data)) {
          throw new Error('API beklenen dizi formatinda donmedi.');
        }

        setTzoneRows(tzoneData as TzoneReadingEvent[]);
        setG1Rows(g1Data as G1ReadingEvent[]);
        setErrorMessage(null);
      } catch (error) {
        console.error('Failed to load panel data', error);
        setTzoneRows([]);
        setG1Rows([]);
        setErrorMessage(
          error instanceof Error ? error.message : 'Veriler yuklenemedi.'
        );
      }
    };

    void loadInitialData();

    socket = io(API_BASE_URL, {
      transports: ['polling', 'websocket']
    });

    socket.on('tzone:reading', (reading: TzoneReadingEvent) => {
      setErrorMessage(null);
      setTzoneRows((current) => [reading, ...current].slice(0, 100));
    });

    socket.on('g1:reading', (reading: G1ReadingEvent) => {
      setErrorMessage(null);
      setG1Rows((current) => [reading, ...current].slice(0, 100));
    });

    return () => {
      socket?.disconnect();
    };
  }, []);

  const isTzoneTab = activeSourceTab === 'tzone';

  return (
    <main className="page-shell">
      <section className="panel">
        <header className="panel-header">
          <p className="eyebrow">Live telemetry</p>
          <h1>Tzone ve G1 Verileri</h1>
          <p className="lede">
            Tzone TCP sicaklik sensoru verileri ve G1 gateway beacon kayitlari ayni panelde ayri sekmelerde gosterilir.
          </p>
        </header>

        <div className="table-wrap">
          {errorMessage ? <p className="status-banner">{errorMessage}</p> : null}

          <div className="tab-list" role="tablist" aria-label="Veri kaynagi">
            <button
              type="button"
              role="tab"
              aria-selected={isTzoneTab}
              className={`tab-button${isTzoneTab ? ' is-active' : ''}`}
              onClick={() => setActiveSourceTab('tzone')}
            >
              <span>Isi Sensorleri</span>
              <strong>{tzoneRows.length}</strong>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isTzoneTab}
              className={`tab-button${!isTzoneTab ? ' is-active' : ''}`}
              onClick={() => setActiveSourceTab('g1')}
            >
              <span>Gateway ve Beacon</span>
              <strong>{g1Rows.length}</strong>
            </button>
          </div>

          {isTzoneTab ? (
            <section className="data-group">
              <div className="group-header">
                <h2>Tzone Sicaklik Olcumleri</h2>
                <span>{tzoneRows.length} kayit</span>
              </div>
              {tzoneRows.length > 0 ? (
                <TzoneTable rows={tzoneRows} />
              ) : (
                <p className="empty-inline">Henuz isi sensor verisi yok.</p>
              )}
            </section>
          ) : (
            <>
              <section className="data-group">
                <div className="group-header">
                  <h2>Gateway Kayitlari</h2>
                  <span>{gatewayRows.length} kayit</span>
                </div>
                {gatewayRows.length > 0 ? (
                  <G1Table rows={gatewayRows} />
                ) : (
                  <p className="empty-inline">Henuz gateway verisi yok.</p>
                )}
              </section>

              <section className="data-group">
                <div className="group-header">
                  <h2>Beacon Kayitlari</h2>
                  <span>{beaconRows.length} kayit</span>
                </div>
                {beaconRows.length > 0 ? (
                  <G1Table rows={beaconRows} />
                ) : (
                  <p className="empty-inline">Henuz beacon verisi yok.</p>
                )}
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
