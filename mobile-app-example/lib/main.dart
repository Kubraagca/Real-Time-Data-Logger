import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

void main() {
  runApp(const TzoneMobileApp());
}

class TzoneMobileApp extends StatelessWidget {
  const TzoneMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tzone Mobile',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0E7490),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFF4F7F8),
        useMaterial3: true,
      ),
      home: const TzoneDashboardPage(),
    );
  }
}

class TzoneDashboardPage extends StatefulWidget {
  const TzoneDashboardPage({super.key});

  @override
  State<TzoneDashboardPage> createState() => _TzoneDashboardPageState();
}

class _TzoneDashboardPageState extends State<TzoneDashboardPage> {
  final TextEditingController _apiBaseUrlController = TextEditingController(
    text: 'https://real-time-data-logger-production.up.railway.app',
  );
  final TextEditingController _socketUrlController = TextEditingController(
    text: 'https://real-time-data-logger-production.up.railway.app',
  );

  final Map<String, DeviceReading> _devices = <String, DeviceReading>{};
  io.Socket? _socket;
  bool _isConnecting = false;
  bool _isSocketConnected = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_connect());
  }

  @override
  void dispose() {
    _socket?.dispose();
    _apiBaseUrlController.dispose();
    _socketUrlController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    if (_isConnecting) {
      return;
    }

    setState(() {
      _isConnecting = true;
      _errorMessage = null;
    });

    await _loadLatestReadings();
    _connectSocket();

    if (mounted) {
      setState(() {
        _isConnecting = false;
      });
    }
  }

  Future<void> _loadLatestReadings() async {
    final String baseUrl = _normalizeBaseUrl(_apiBaseUrlController.text);
    if (baseUrl.isEmpty) {
      setState(() {
        _errorMessage = 'API URL bos olamaz.';
      });
      return;
    }

    try {
      final Uri uri = Uri.parse('$baseUrl/api/tzone/readings/latest?limit=50');
      final http.Response response = await http.get(uri);

      if (response.statusCode != 200) {
        throw Exception('HTTP ${response.statusCode}');
      }

      final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;

      setState(() {
        _devices.clear();
        for (final dynamic item in data) {
          final DeviceReading reading = DeviceReading.fromApi(item as Map<String, dynamic>);
          final String key = reading.imei.isEmpty ? 'unknown-${reading.receivedAt}' : reading.imei;
          final DeviceReading? current = _devices[key];

          if (current == null || reading.receivedAt.isAfter(current.receivedAt)) {
            _devices[key] = reading;
          }
        }
      });
    } catch (error) {
      setState(() {
        _errorMessage = 'Son veriler alinamadi: $error';
      });
    }
  }

  void _connectSocket() {
    final String socketUrl = _normalizeBaseUrl(_socketUrlController.text);
    if (socketUrl.isEmpty) {
      setState(() {
        _errorMessage = 'Socket URL bos olamaz.';
      });
      return;
    }

    _socket?.dispose();

    final io.Socket socket = io.io(
      socketUrl,
      io.OptionBuilder()
          .setTransports(<String>['polling', 'websocket'])
          .disableAutoConnect()
          .enableForceNew()
          .build(),
    );

    socket.onConnect((_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSocketConnected = true;
        _errorMessage = null;
      });
    });

    socket.onDisconnect((_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSocketConnected = false;
      });
    });

    socket.onConnectError((dynamic error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSocketConnected = false;
        _errorMessage = 'Socket baglanti hatasi: $error';
      });
    });

    socket.onError((dynamic error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = 'Socket hatasi: $error';
      });
    });

    socket.on('tzone:reading', (dynamic payload) {
      if (!mounted || payload is! Map) {
        return;
      }

      final DeviceReading reading = DeviceReading.fromSocket(
        Map<String, dynamic>.from(payload as Map<dynamic, dynamic>),
      );
      final String key = reading.imei.isEmpty ? 'unknown-${reading.receivedAt}' : reading.imei;

      setState(() {
        _devices[key] = reading;
      });
    });

    socket.connect();
    _socket = socket;
  }

  Future<void> _refresh() async {
    await _loadLatestReadings();
  }

  @override
  Widget build(BuildContext context) {
    final List<DeviceReading> readings = _devices.values.toList()
      ..sort((DeviceReading a, DeviceReading b) => b.receivedAt.compareTo(a.receivedAt));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tzone Mobile'),
        backgroundColor: Colors.white,
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _ConnectionCard(
              apiBaseUrlController: _apiBaseUrlController,
              socketUrlController: _socketUrlController,
              isConnecting: _isConnecting,
              isSocketConnected: _isSocketConnected,
              onConnectPressed: _connect,
            ),
            const SizedBox(height: 16),
            if (_errorMessage != null) ...<Widget>[
              _MessageCard(message: _errorMessage!, color: const Color(0xFFB91C1C)),
              const SizedBox(height: 16),
            ],
            _MessageCard(
              message: _isSocketConnected
                  ? 'Canli baglanti aktif. Yeni veriler otomatik dusuyor.'
                  : 'Canli baglanti bekleniyor. API ile son veriler gosteriliyor.',
              color: _isSocketConnected ? const Color(0xFF0F766E) : const Color(0xFF9A6700),
            ),
            const SizedBox(height: 16),
            if (readings.isEmpty)
              const _EmptyState()
            else
              ...readings.map((DeviceReading reading) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _ReadingCard(reading: reading),
                  )),
          ],
        ),
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({
    required this.apiBaseUrlController,
    required this.socketUrlController,
    required this.isConnecting,
    required this.isSocketConnected,
    required this.onConnectPressed,
  });

  final TextEditingController apiBaseUrlController;
  final TextEditingController socketUrlController;
  final bool isConnecting;
  final bool isSocketConnected;
  final Future<void> Function() onConnectPressed;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  isSocketConnected ? Icons.wifi_tethering : Icons.wifi_tethering_error,
                  color: isSocketConnected ? const Color(0xFF0F766E) : const Color(0xFFB45309),
                ),
                const SizedBox(width: 8),
                Text(
                  isSocketConnected ? 'Socket bagli' : 'Socket bagli degil',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: apiBaseUrlController,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'API Base URL',
                hintText: 'https://your-backend-domain.up.railway.app',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: socketUrlController,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Socket URL',
                hintText: 'https://your-backend-domain.up.railway.app',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: isConnecting ? null : onConnectPressed,
                child: Text(isConnecting ? 'Baglaniyor...' : 'Baglan ve Yenile'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({
    required this.message,
    required this.color,
  });

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        message,
        style: TextStyle(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: <Widget>[
            const Icon(Icons.sensors_off, size: 48, color: Color(0xFF64748B)),
            const SizedBox(height: 12),
            Text(
              'Henuz veri yok',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'Backend URL dogruysa ve cihaz veri gonderiyorsa son okumalar burada listelenecek.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _ReadingCard extends StatelessWidget {
  const _ReadingCard({required this.reading});

  final DeviceReading reading;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    reading.imei.isEmpty ? 'IMEI bilinmiyor' : reading.imei,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  _formatDate(reading.receivedAt),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: <Widget>[
                _MetricChip(label: 'Sicaklik', value: reading.temperatureText),
                _MetricChip(label: 'Nem', value: reading.humidityText),
                _MetricChip(label: 'Pil', value: reading.batteryText),
                _MetricChip(label: 'Isik', value: reading.lightText),
              ],
            ),
            if (reading.rawHex.isNotEmpty) ...<Widget>[
              const SizedBox(height: 14),
              SelectableText(
                'rawHex: ${reading.rawHex}',
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: Color(0xFF334155),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetricChip extends StatelessWidget {
  const _MetricChip({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 145,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFE2E8F0),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ],
      ),
    );
  }
}

class DeviceReading {
  DeviceReading({
    required this.imei,
    required this.temperature,
    required this.humidity,
    required this.battery,
    required this.light,
    required this.receivedAt,
    required this.rawHex,
  });

  final String imei;
  final double? temperature;
  final double? humidity;
  final double? battery;
  final double? light;
  final DateTime receivedAt;
  final String rawHex;

  String get temperatureText => temperature == null ? '-' : '${temperature!.toStringAsFixed(1)} C';
  String get humidityText => humidity == null ? '-' : '${humidity!.toStringAsFixed(1)} %';
  String get batteryText => battery == null ? '-' : battery!.toStringAsFixed(1);
  String get lightText => light == null ? '-' : light!.toStringAsFixed(1);

  factory DeviceReading.fromApi(Map<String, dynamic> json) {
    return DeviceReading(
      imei: (json['imei'] ?? '').toString(),
      temperature: _parseNumber(json['temperature']),
      humidity: _parseNumber(json['humidity']),
      battery: _parseNumber(json['battery']),
      light: _parseNumber(json['light']),
      receivedAt: DateTime.tryParse((json['receivedAt'] ?? '').toString()) ?? DateTime.now(),
      rawHex: (json['rawHex'] ?? '').toString(),
    );
  }

  factory DeviceReading.fromSocket(Map<String, dynamic> json) {
    return DeviceReading(
      imei: (json['imei'] ?? '').toString(),
      temperature: _parseNumber(json['temperature']),
      humidity: _parseNumber(json['humidity']),
      battery: _parseNumber(json['battery']),
      light: _parseNumber(json['light']),
      receivedAt: DateTime.tryParse((json['receivedAt'] ?? '').toString()) ?? DateTime.now(),
      rawHex: (json['rawHex'] ?? '').toString(),
    );
  }

  static double? _parseNumber(dynamic value) {
    if (value == null) {
      return null;
    }

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(value.toString());
  }
}

String _normalizeBaseUrl(String value) {
  final String trimmed = value.trim();
  if (trimmed.isEmpty) {
    return '';
  }

  return trimmed.endsWith('/') ? trimmed.substring(0, trimmed.length - 1) : trimmed;
}

String _formatDate(DateTime value) {
  final DateTime local = value.toLocal();
  final String day = local.day.toString().padLeft(2, '0');
  final String month = local.month.toString().padLeft(2, '0');
  final String year = local.year.toString();
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');

  return '$day.$month.$year $hour:$minute';
}
