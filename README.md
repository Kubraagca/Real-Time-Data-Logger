# RealTimeDataLogger

Bu proje, Tzone TT18-4G-M cihazindan gelen TCP verilerini ve G1 gateway uzerinden gelen beacon/gateway verilerini alip veritabanina kaydeden ve istemcilere anlik ileten bir backend icerir.

## Klasorler

- `backend`: Express + Prisma + Socket.IO + TCP listener + MQTT subscriber
- `web-panel-example`: React ile canli panel ornegi
- `tools/public-tzone-listener`: Railway uzerinde yalnizca debug amacli public TCP listener
- `docs/flutter-websocket-example.md`: Flutter baglanti notu

## Backend kurulumu

1. `backend/.env.example` dosyasini `.env` olarak kopyalayin.
2. `backend` icinde bagimliliklari kurun.
3. Prisma migration calistirin.
4. Backend'i baslatin.

Ornek komutlar:

```bash
npm install
npm run prisma:migrate --workspace backend
npm run prisma:generate --workspace backend
npm run dev:backend
```

## Tzone TCP ayari

Tzone cihaz uzerinde su bilgileri girin:

- IP/Domain: Backend'in public domain'i veya VPS public IP'si
- Port: `TZONE_TCP_PORT` degeri, ornek `18801`
- TCP/UDP: `TCP`
- APN: SIM kart operatorunun verdigi APN bilgisi

## G1 HTTP ayari

G1 gateway tarafinda su alanlari kullanin:

- Service Access: `HTTP`
- Data Format: `JSON-LONG`
- Upload Interval: `1000 ms`
- URL: `https://YOUR_BACKEND_DOMAIN/gw/<gatewayMac>/status`

Ornek:

```text
https://real-time-data-logger-production.up.railway.app/gw/ac233fc0211b/status
```

Notlar:

- Gateway HTTP POST ile veri yollar.
- Bos ping paketlerinde backend `200` doner ve cihaz veri gondermeye devam eder.
- Test icin alternatif endpoint: `POST /api/g1/http`

## Tzone API endpointleri

- `GET /health`
- `GET /api/tzone/readings/latest`
- `GET /api/tzone/devices`
- `GET /api/tzone/devices/:imei/readings?limit=100`

Bu endpointler yalnizca Tzone TCP cihaz verilerini doner.

## G1 API endpointleri

- `POST /api/g1/http`
- `POST /gw/:gatewayMac/status`
- `GET /api/g1/readings/latest`
- `GET /api/g1/devices`
- `GET /api/g1/devices/:imei/readings?limit=100`

Bu endpointler yalnizca G1 gateway ve beacon verilerini doner.

`GET /api/tzone/devices` cevabinda her cihaz icin `isOnline` ve `onlineStatus`
alanlari da doner. Varsayilan olarak son `10` dakika icinde veri geldiyse cihaz
`online` sayilir. Bu pencere `TZONE_ONLINE_WINDOW_MINUTES` ile degistirilebilir.

## Socket eventleri

Tzone TCP event'i:

```text
tzone:reading
```

G1 gateway/beacon event'i:

```text
g1:reading
```

Payload ornegi:

```json
{
  "imei": "862938475612345",
  "source": "tzone",
  "deviceType": null,
  "gatewayMac": null,
  "bleName": null,
  "rssi": null,
  "temperature": 25.4,
  "humidity": 60,
  "light": null,
  "battery": null,
  "receivedAt": "2026-06-26T09:15:30.000Z",
  "rawHex": "404441544123"
}
```

## TCP log davranisi

Ilk asamada parser netlesene kadar backend her paketi su bilgilerle loglar:

- device remote address
- receivedAt
- raw hex
- ascii preview

## Parser notu

Bu ilk surum parser, TT18-4G-M icin guvenli ingestion amaclidir:

- Parse edilemeyen paketlerde exception firlatmaz
- Ham veriyi yine de veritabanina kaydeder
- ASCII formatli, anahtar/deger benzeri paketlerde `imei`, `temperature`, `humidity`, `battery`, `light`, `rtcTime` ve `packetIndex` alanlarini ayiklamaya calisir
- Binary paketlerde ham veri ve olasi IMEI adayini saklar

Elinizde resmi TT18-4G-M protocol dokumani veya ornek raw paketler oldugunda `backend/src/tzone/tzone.parser.ts` icindeki alan eslestirmelerini kesin formata gore guncelleyebiliriz.
