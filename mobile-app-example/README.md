# Tzone Mobile

Bu klasor, `Tzone Mobile` adli, Tzone backend'ine baglanan ornek bir Flutter mobil uygulamasidir.

## Ne Yapar

- `GET /api/tzone/readings/latest` ile son verileri ceker
- Socket.IO ile `tzone:reading` event'ini dinler
- IMEI, sicaklik, nem, pil ve raw hex bilgisini gosterir
- Firebase Cloud Messaging ile kritik sicaklik bildirimlerini alir

Not: Bu uygulama yalnizca Tzone TCP sicaklik olcer verisini gosterir. G1 gateway/beacon verileri burada listelenmez.

## Gerekli Bilgi

Uygulama acilinca iki URL ister:

- `API Base URL`
- `Socket URL`

Ikisi de ilk testte ayni olabilir. Ornek:

```text
https://your-backend-domain.up.railway.app
```

Firebase icin Android tarafta su dosyayi da ekleyin:

- `mobile-app-example/android/app/google-services.json`

Backend `.env` icinde su alanlari doldurulmalidir:

```text
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_ALERT_TOPIC=critical-temperature-alerts
TZONE_CRITICAL_TEMP_C=40
TZONE_CRITICAL_ALERT_COOLDOWN_MINUTES=30
```

## Calistirma

```bash
flutter pub get
flutter run
```

Backend icin yeni bagimliligi yukleyin:

```bash
npm install --workspace backend
```

## Android Telefona Kablosuz Yukleme

```bash
adb tcpip 5555
adb connect TELEFON_IP:5555
flutter run
```

Not:

- Telefon ve bilgisayar ayni agda olmali
- Backend Railway uzerindeyse telefon dogrudan Railway URL'sine baglanabilir
