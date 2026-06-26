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
  "imei": "862938475612345",
  "temperature": 25.4,
  "humidity": 60,
  "light": null,
  "battery": null,
  "receivedAt": "2026-06-26T09:15:30.000Z",
  "rawHex": "404441544123"
}
```
