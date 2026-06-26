# Tzone Local Listener

Bu script, Tzone TT18 cihazindan gelen TCP verisini yerelde dinlemek icin kullanilir.

## Calistirma

```powershell
cd C:\Users\Kubra\Desktop\RealTimeDataLogger
python .\tools\tzone_local_listener.py --port 18801 --ack
```

## Ne Yapar

- `connect` ve `close` olaylarini consola yazar
- gelen paketi `HEX` ve `ASCII preview` olarak gosterir
- `TZ` paketini parse etmeye calisir
- `MessageID` okunursa `@ACK,<id>#` geri gonderebilir

## Beklenen Dogru Paket

Gercek Tzone basic data paketi genelde:

- `545A` ile baslar
- icinde `2424` bulunur
- TT18-4G-M icin `0407` gorulur
- sonda `0D0A` olur

## Onemli

SIM kartli cihaz, internete cikarak size baglanacaksa:

- sadece bu scripti acmak yetmez
- public IP veya port forwarding gerekir
- Windows Firewall'da ilgili port acik olmalidir

Ayni yerel agda ve cihaz o IP'ye gidebiliyorsa test daha kolaydir.
