# Public Tzone Listener

Bu klasor, `tzone_local_listener.py` scriptinin public sunucuda calisacak Railway surumudur.

## Ne icin kullanilir

- Tzone cihazindan gelen TCP paketini public internette dinlemek
- ham `HEX` ve `ASCII preview` loglarini gormek
- gercek TT18 paketi gelirse `temperature`, `humidity`, `battery`, `light` gibi alanlari parse etmek
- `MessageID` okunursa `@ACK,<id>#` donmek

## Railway'de ayaga kaldirma

1. Railway'de yeni bir service olustur.
2. Ayni GitHub repoyu sec.
3. `Root Directory` olarak `tools/public-tzone-listener` gir.
4. `Builder` olarak `Dockerfile` algilanacak.
5. Variables kismina sunlari ekle:

```env
TZONE_TCP_PORT=18801
TZONE_ACK=true
LISTENER_HOST=0.0.0.0
```

6. Service deploy olduktan sonra `Networking` altindan bir `TCP Proxy` ac.
7. Internal port olarak `18801` gir.
8. Railway'in verdigi public domain ve portu cihaza yaz:

- `IP/Domain`: Railway TCP proxy domaini
- `Port`: Railway TCP proxy public portu
- `TCP/UDP`: `TCP`

## Beklenen loglar

Baglanti geldiginde:

```text
[CONNECT] 100.64.0.2:29298
```

Ham veri geldiginde:

```text
[RAW] {"remoteAddress":"100.64.0.2","remotePort":29298,"receivedAt":"...","rawHex":"...","asciiPreview":"..."}
```

Parse sonucu:

```text
[PARSED] {"protocol":"tzone-binary","imei":"...","temperature":27.8,"humidity":52.1,...}
[STATUS] {"imei":"...","temperature":27.8,"humidity":52.1,...}
```

ACK donerse:

```text
[ACK] @ACK,123#
```

## Onemli not

- `160301...` ile baslayan veri cihaz sensor paketi degil, TLS/HTTPS trafigidir.
- Gercek Tzone TT18 paketi genelde `545A` ile baslar ve `0D0A` ile biter.
- Bu service sadece debug icindir. Uretimde asil backend yerine gecmez.
