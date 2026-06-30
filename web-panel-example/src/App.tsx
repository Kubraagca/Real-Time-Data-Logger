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

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatNumber(value: number | null | undefined, suffix = '') {
  return typeof value === 'number' ? `${value}${suffix}` : '-';
}

function SectionCard({
  title,
  count,
  note,
  children
}: {
  title: string;
  count: number;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section-card">
      <header className="section-card-header">
        <div>
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
        <span className="section-count">{count} kayit</span>
      </header>
      {children}
    </section>
  );
}

function TzoneTable({ rows }: { rows: TzoneReadingEvent[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Zaman</th>
            <th>Cihaz</th>
            <th>Olcumler</th>
            <th>Paket</th>
            <th>Ham Veri</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.imei ?? 'unknown'}-${row.receivedAt}-${index}`}>
              <td>{formatTimestamp(row.receivedAt)}</td>
              <td>
                <strong className="mono">{row.imei ?? '-'}</strong>
                <div>TCP sicaklik sensoru</div>
              </td>
              <td>
                <div className="metric-stack">
                  <span>Sicaklik: {formatNumber(row.temperature, ' C')}</span>
                  <span>Nem: {formatNumber(row.humidity, ' %')}</span>
                  <span>Isik: {formatNumber(row.light)}</span>
                  <span>Batarya: {formatNumber(row.battery)}</span>
                </div>
              </td>
              <td>{formatNumber(row.packetIndex)}</td>
              <td>
                <code className="raw-block">{row.rawHex || '-'}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function G1Table({ rows }: { rows: G1ReadingEvent[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Zaman</th>
            <th>Cihaz</th>
            <th>Durum</th>
            <th>Raw Data</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.mac ?? 'unknown'}-${row.timestamp}-${index}`}>
              <td>{formatTimestamp(row.timestamp)}</td>
              <td>
                <span className={`type-badge type-${normalizeG1Type(row.type).toLowerCase()}`}>
                  {normalizeG1Type(row.type)}
                </span>
                <strong className="mono row-main-id">{row.mac ?? '-'}</strong>
                <div>
                  {row.bleName && row.bleName.trim()
                    ? row.bleName
                    : 'BLE Name yok'}
                </div>
              </td>
              <td>
                <div className="metric-stack">
                  <span>BLE No: {formatNumber(row.bleNo)}</span>
                  <span>RSSI: {formatNumber(row.rssi, ' dBm')}</span>
                  <span>Gateway Free: {formatNumber(row.gatewayFree, ' MB')}</span>
                  <span>Gateway Load: {formatNumber(row.gatewayLoad)}</span>
                </div>
              </td>
              <td>
                <code className="raw-block">{row.rawData ?? '-'}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function App() {
  const [tzoneRows, setTzoneRows] = useState<TzoneReadingEvent[]>([]);
  const [g1Rows, setG1Rows] = useState<G1ReadingEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeSourceTab, setActiveSourceTab] = useState<SourceTab>('tzone');

  const gatewayRows = g1Rows.filter(isGatewayReading);
  const beaconRows = g1Rows.filter((row) => !isGatewayReading(row));
  const isTzoneTab = activeSourceTab === 'tzone';

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
        setErrorMessage(error instanceof Error ? error.message : 'Veriler yuklenemedi.');
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

  return (
    <main className="page-shell">
      <section className="panel">
        <header className="panel-header">
          <div className="hero-copy">
            <p className="eyebrow">Realtime Monitor</p>
            <h1>Sensor ve Gateway Kontrol Paneli</h1>
            <p className="lede">
              Tzone isi sensoru kayitlarini ve G1 gateway beacon akisini ayni ekranda,
              ama birbirine karismayacak sekilde ayri is akislari olarak izleyin.
            </p>
          </div>
          <div className="hero-status">
            <span className="status-pill">TZONE {tzoneRows.length}</span>
            <span className="status-pill">G1 {g1Rows.length}</span>
          </div>
        </header>

        <div className="workspace">
          {errorMessage ? <p className="status-banner">{errorMessage}</p> : null}

          <nav className="source-switch" aria-label="Veri kaynagi">
            <button
              type="button"
              className={`source-button${isTzoneTab ? ' is-active' : ''}`}
              onClick={() => setActiveSourceTab('tzone')}
            >
              <span className="source-title">Isi Sensorleri</span>
              <span className="source-subtitle">Tzone TCP hatti</span>
            </button>
            <button
              type="button"
              className={`source-button${!isTzoneTab ? ' is-active' : ''}`}
              onClick={() => setActiveSourceTab('g1')}
            >
              <span className="source-title">Gateway ve Beacon</span>
              <span className="source-subtitle">G1 HTTP JSON-LONG hatti</span>
            </button>
          </nav>

          {isTzoneTab ? (
            <section className="content-panel content-panel-tzone">
              <header className="content-header">
                <div>
                  <p className="section-kicker">Kaynak 01</p>
                  <h2>Tzone Sicaklik Olcumleri</h2>
                </div>
                <span className="content-count">{tzoneRows.length} kayit</span>
              </header>

              <SectionCard
                title="Canli Tzone Akisi"
                count={tzoneRows.length}
                note="Sicaklik, nem, isik ve batarya alanlari tek tabloda gosterilir."
              >
                {tzoneRows.length > 0 ? (
                  <TzoneTable rows={tzoneRows} />
                ) : (
                  <p className="empty-inline">Henuz isi sensor verisi yok.</p>
                )}
              </SectionCard>
            </section>
          ) : (
            <section className="content-panel content-panel-g1">
              <header className="content-header">
                <div>
                  <p className="section-kicker">Kaynak 02</p>
                  <h2>Beacon Kayitlari</h2>
                </div>
                <span className="content-count">{beaconRows.length} kayit</span>
              </header>

              <SectionCard
                title="Canli Beacon Akisi"
                count={beaconRows.length}
                note="Gateway'in algiladigi beacon ve yakinlik kayitlari."
              >
                {beaconRows.length > 0 ? (
                  <G1Table rows={beaconRows} />
                ) : (
                  <p className="empty-inline">Henuz beacon verisi yok.</p>
                )}
              </SectionCard>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
