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
      title: 'Tzone Monitor',
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
  Timer? _refreshTimer;
  bool _isConnecting = false;
  bool _isSocketConnected = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_connect());
    _refreshTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted) {
        unawaited(_loadLatestReadings());
      }
    });
  }

  @override
  void dispose() {
    _socket?.dispose();
    _refreshTimer?.cancel();
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

      unawaited(_loadLatestReadings());
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
        Map<String, dynamic>.from(payload),
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
    final DeviceReading? latestReading = readings.isEmpty ? null : readings.first;
    final int onlineCount = readings.where((DeviceReading reading) => reading.hasFreshMetrics).length;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: EdgeInsets.zero,
          children: <Widget>[
            _HeroSection(
              isSocketConnected: _isSocketConnected,
              readingCount: readings.length,
              latestSeenAt: latestReading?.receivedAt,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  _SummaryGrid(
                    cards: <_SummaryCardData>[
                      _SummaryCardData(
                        label: 'Kayit',
                        value: '$readings.length',
                        note: 'Son 50 veri',
                      ),
                      _SummaryCardData(
                        label: 'Aktif Sensor',
                        value: '$onlineCount',
                        note: 'Olcumlu cihaz',
                      ),
                      _SummaryCardData(
                        label: 'Son Sicaklik',
                        value: latestReading?.temperatureText ?? '-',
                        note: 'En guncel veri',
                      ),
                      _SummaryCardData(
                        label: 'Son Nem',
                        value: latestReading?.humidityText ?? '-',
                        note: 'En guncel veri',
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
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
                        ? 'Canli baglanti aktif. Yeni Tzone verileri geldikce liste otomatik yenilenir.'
                        : 'Socket baglantisi bekleniyor. API ile 15 saniyede bir otomatik yenileme yapiliyor.',
                    color:
                        _isSocketConnected ? const Color(0xFF0F766E) : const Color(0xFF9A6700),
                  ),
                  const SizedBox(height: 18),
                  _SectionHeader(title: 'Canli Tzone Akisi', count: readings.length),
                  const SizedBox(height: 12),
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
          ],
        ),
      ),
    );
  }
}

class _HeroSection extends StatelessWidget {
  const _HeroSection({
    required this.isSocketConnected,
    required this.readingCount,
    required this.latestSeenAt,
  });

  final bool isSocketConnected;
  final int readingCount;
  final DateTime? latestSeenAt;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: <Color>[Color(0xFFC96D00), Color(0xFF0F766E)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.16),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    isSocketConnected ? 'CANLI' : 'BEKLEMEDE',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.8,
                        ),
                  ),
                ),
                const Spacer(),
                Text(
                  '$readingCount kayit',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              'Tzone Monitor',
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              latestSeenAt == null
                  ? 'Tzone isi sensoru verileri bu ekranda listelenir.'
                  : 'Son veri: ${_formatDate(latestSeenAt!)}',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: Colors.white.withOpacity(0.92),
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryCardData {
  const _SummaryCardData({
    required this.label,
    required this.value,
    required this.note,
  });

  final String label;
  final String value;
  final String note;
}

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.cards});

  final List<_SummaryCardData> cards;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: cards.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 1.35,
      ),
      itemBuilder: (BuildContext context, int index) {
        final _SummaryCardData card = cards[index];

        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFD8E1E8)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                card.label,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: const Color(0xFF627D98),
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const Spacer(),
              Text(
                card.value,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: const Color(0xFF102A43),
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                card.note,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: const Color(0xFF627D98),
                    ),
              ),
            ],
          ),
        );
      },
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
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: Padding(
        padding: const EdgeInsets.all(18),
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
            const SizedBox(height: 10),
            Text(
              'Baglanti adreslerini burada yonetin. Socket sorunlu olsa bile API periyodik yenilenir.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: const Color(0xFF627D98),
                  ),
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
        color: color.withOpacity(0.1),
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
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFD8E1E8)),
      ),
      child: Column(
        children: <Widget>[
          const Icon(Icons.thermostat_auto, size: 48, color: Color(0xFF64748B)),
          const SizedBox(height: 12),
          Text(
            'Henuz Tzone verisi yok',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          const Text(
            'API veya socket baglantisi kuruldugunda gelen sicaklik olcumleri burada listelenecek.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _InlineEmptyState extends StatelessWidget {
  const _InlineEmptyState({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF3F8),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        message,
        style: Theme.of(context).textTheme.bodyMedium,
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.count,
  });

  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              title,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: const Color(0xFF102A43),
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFEAF2F0),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              '$count cihaz',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: const Color(0xFF0F766E),
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PrimaryMetric extends StatelessWidget {
  const _PrimaryMetric({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 152,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.10),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 12),
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: const Color(0xFF627D98),
                  fontWeight: FontWeight.w600,
                ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: const Color(0xFF102A43),
                  fontWeight: FontWeight.w800,
                ),
          ),
        ],
      ),
    );
  }
}

class _RawHexBlock extends StatelessWidget {
  const _RawHexBlock({required this.rawHex});

  final String rawHex;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF4F7FA),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Ham Veri',
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: const Color(0xFF486581),
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 8),
          SelectableText(
            rawHex,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 12,
              color: Color(0xFF334155),
              height: 1.45,
            ),
          ),
        ],
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
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    reading.imei.isEmpty ? 'Cihaz kimligi yok' : reading.displayId,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  _formatDate(reading.receivedAt),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 16),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: <Widget>[
                  _PrimaryMetric(
                    label: 'Sicaklik',
                    value: reading.temperatureText,
                    icon: Icons.thermostat,
                    color: const Color(0xFFB45309),
                  ),
                  const SizedBox(width: 10),
                  _PrimaryMetric(
                    label: 'Nem',
                    value: reading.humidityText,
                    icon: Icons.water_drop,
                    color: const Color(0xFF0E7490),
                  ),
                  const SizedBox(width: 10),
                  _PrimaryMetric(
                    label: 'Pil',
                    value: reading.batteryText,
                    icon: Icons.battery_charging_full,
                    color: const Color(0xFF0F766E),
                  ),
                  const SizedBox(width: 10),
                  _PrimaryMetric(
                    label: 'Isik',
                    value: reading.lightText,
                    icon: Icons.light_mode,
                    color: const Color(0xFFCA8A04),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: <Widget>[
                _MetricChip(label: 'Kaynak', value: reading.deviceTypeText),
                _MetricChip(label: 'RSSI', value: reading.rssiText),
                _MetricChip(label: 'Gateway', value: reading.gatewayText),
                _MetricChip(label: 'Gateway Free', value: reading.gatewayFreeText),
                _MetricChip(label: 'Gateway Load', value: reading.gatewayLoadText),
              ],
            ),
            if (reading.rawHex.isNotEmpty) ...<Widget>[
              const SizedBox(height: 16),
              _RawHexBlock(rawHex: reading.rawHex),
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF2F8),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: const Color(0xFF627D98),
                  fontWeight: FontWeight.w600,
                ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: const Color(0xFF102A43),
                  fontWeight: FontWeight.w700,
                ),
          ),
        ],
      ),
    );
  }
}

class DeviceReading {
  DeviceReading({
    required this.imei,
    required this.source,
    required this.deviceType,
    required this.gatewayMac,
    required this.bleName,
    required this.rssi,
    required this.gatewayFree,
    required this.gatewayLoad,
    required this.temperature,
    required this.humidity,
    required this.battery,
    required this.light,
    required this.receivedAt,
    required this.rawHex,
  });

  final String imei;
  final String source;
  final String? deviceType;
  final String? gatewayMac;
  final String? bleName;
  final double? rssi;
  final double? gatewayFree;
  final double? gatewayLoad;
  final double? temperature;
  final double? humidity;
  final double? battery;
  final double? light;
  final DateTime receivedAt;
  final String rawHex;
  bool get hasFreshMetrics =>
      temperature != null || humidity != null || battery != null || light != null;

  String get displayId => bleName == null || bleName!.isEmpty ? imei : '${bleName!} - $imei';
  String? get normalizedDeviceType {
    final String? value = deviceType?.trim();
    if (value == null || value.isEmpty) {
      return null;
    }

    return value.toLowerCase() == 'gateway' ? 'Gateway' : value;
  }

  String get deviceTypeText => normalizedDeviceType ?? source.toUpperCase();
  String get gatewayText => gatewayMac ?? '-';
  String get rssiText => rssi == null ? '-' : '${rssi!.toStringAsFixed(0)} dBm';
  String get gatewayFreeText => gatewayFree == null ? '-' : '${gatewayFree!.toStringAsFixed(0)} MB';
  String get gatewayLoadText => gatewayLoad == null ? '-' : gatewayLoad!.toStringAsFixed(2);
  String get temperatureText => temperature == null ? '-' : '${temperature!.toStringAsFixed(1)} C';
  String get humidityText => humidity == null ? '-' : '${humidity!.toStringAsFixed(1)} %';
  String get batteryText => battery == null ? '-' : battery!.toStringAsFixed(1);
  String get lightText => light == null ? '-' : light!.toStringAsFixed(1);

  factory DeviceReading.fromApi(Map<String, dynamic> json) {
    return DeviceReading(
      imei: (json['imei'] ?? '').toString(),
      source: (json['source'] ?? 'tzone').toString(),
      deviceType: _parseString(json['deviceType']),
      gatewayMac: _parseString(json['gatewayMac']),
      bleName: _parseString(json['bleName']),
      rssi: _parseNumber(json['rssi']),
      gatewayFree: _parseNumber(json['gatewayFree']),
      gatewayLoad: _parseNumber(json['gatewayLoad']),
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
      source: (json['source'] ?? 'tzone').toString(),
      deviceType: _parseString(json['deviceType']),
      gatewayMac: _parseString(json['gatewayMac']),
      bleName: _parseString(json['bleName']),
      rssi: _parseNumber(json['rssi']),
      gatewayFree: _parseNumber(json['gatewayFree']),
      gatewayLoad: _parseNumber(json['gatewayLoad']),
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

  static String? _parseString(dynamic value) {
    if (value == null) {
      return null;
    }

    final String text = value.toString().trim();
    return text.isEmpty ? null : text;
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
