# Tzone Mobile

Bu klasor, `Tzone Mobile` adli, Tzone backend'ine baglanan ornek bir Flutter mobil uygulamasidir.

## Ne Yapar

- `GET /api/tzone/readings/latest` ile son verileri ceker
- Socket.IO ile `tzone:reading` event'ini dinler
- IMEI, sicaklik, nem, pil ve raw hex bilgisini gosterir

Not: Bu uygulama yalnizca Tzone TCP sicaklik olcer verisini gosterir. G1 gateway/beacon verileri burada listelenmez.

## Gerekli Bilgi

Uygulama acilinca iki URL ister:

- `API Base URL`
- `Socket URL`

Ikisi de ilk testte ayni olabilir. Ornek:

```text
https://your-backend-domain.up.railway.app
```

## Calistirma

```bash
flutter pub get
flutter run
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
