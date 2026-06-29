# Flutter Socket.IO baglanti notu

Flutter tarafinda `socket_io_client` paketi ile backend'e baglanabilirsiniz:

```dart
import 'package:socket_io_client/socket_io_client.dart' as io;

final socket = io.io(
  'http://YOUR_BACKEND_HOST:3001',
  io.OptionBuilder()
      .setTransports(['websocket'])
      .disableAutoConnect()
      .build(),
);

socket.connect();

socket.onConnect((_) {
  print('Socket connected');
});

socket.on('tzone:reading', (data) {
  print('Yeni Tzone reading: $data');
});

socket.onDisconnect((_) {
  print('Socket disconnected');
});
```

Dinlenecek event adi: `tzone:reading`

Beklenen payload ornegi:

```json
{
  "imei": "AC233FA449F0",
  "source": "g1",
  "deviceType": "S3",
  "gatewayMac": "AC233FC0211B",
  "bleName": null,
  "rssi": -70,
  "temperature": 24.3,
  "humidity": 58.7,
  "light": null,
  "battery": 100,
  "receivedAt": "2026-06-26T09:15:30.000Z",
  "rawHex": "7B2274797065223A225333227D"
}
```
