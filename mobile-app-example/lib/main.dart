import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

const String kCriticalTemperatureTopic = 'critical-temperature-alerts';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
  await Firebase.initializeApp();
  await PushNotificationService.instance.initialize();
  runApp(const TzoneMobileApp());
}

class PushNotificationService {
  PushNotificationService._();

  static final PushNotificationService instance = PushNotificationService._();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }

    final NotificationSettings permissionSettings =
        await FirebaseMessaging.instance.requestPermission(alert: true, badge: true, sound: true);

    if (permissionSettings.authorizationStatus == AuthorizationStatus.authorized ||
        permissionSettings.authorizationStatus == AuthorizationStatus.provisional) {
      await FirebaseMessaging.instance.subscribeToTopic(kCriticalTemperatureTopic);
    }

    _initialized = true;
  }
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
  final List<G1Reading> _g1Readings = <G1Reading>[];
  io.Socket? _socket;
  Timer? _refreshTimer;
  bool _isConnecting = false;
  bool _isSocketConnected = false;
  bool _showConnectionSettings = false;
  SourceTab _activeSourceTab = SourceTab.tzone;
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
      final Uri tzoneUri = Uri.parse('$baseUrl/api/tzone/readings/latest?limit=50');
      final Uri g1Uri = Uri.parse('$baseUrl/api/g1/readings/latest?limit=50');
      final List<http.Response> responses = await Future.wait(<Future<http.Response>>[
        http.get(tzoneUri),
        http.get(g1Uri),
      ]);

      if (responses[0].statusCode != 200) {
        throw Exception('TZONE HTTP ${responses[0].statusCode}');
      }

      if (responses[1].statusCode != 200) {
        throw Exception('G1 HTTP ${responses[1].statusCode}');
      }

      final List<dynamic> tzoneData = jsonDecode(responses[0].body) as List<dynamic>;
      final List<dynamic> g1Data = jsonDecode(responses[1].body) as List<dynamic>;

      setState(() {
        _devices.clear();
        for (final dynamic item in tzoneData) {
          final DeviceReading reading = DeviceReading.fromApi(item as Map<String, dynamic>);
          final String key = reading.imei.isEmpty ? 'unknown-${reading.receivedAt}' : reading.imei;
          final DeviceReading? current = _devices[key];

          if (current == null || reading.receivedAt.isAfter(current.receivedAt)) {
            _devices[key] = reading;
          }
        }

        _g1Readings
          ..clear()
          ..addAll(
            g1Data.map((dynamic item) => G1Reading.fromApi(item as Map<String, dynamic>)),
          );
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
          .setTransports(<String>['websocket'])
          .disableAutoConnect()
          .enableForceNew()
          .enableReconnection()
          .setReconnectionAttempts(10)
          .setReconnectionDelay(1500)
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

    socket.on('g1:reading', (dynamic payload) {
      if (!mounted || payload is! Map) {
        return;
      }

      final G1Reading reading = G1Reading.fromApi(Map<String, dynamic>.from(payload));

      setState(() {
        _g1Readings.insert(0, reading);
        if (_g1Readings.length > 50) {
          _g1Readings.removeRange(50, _g1Readings.length);
        }
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
    final double gatewayListHeight = MediaQuery.of(context).size.height * 0.58;
    final List<DeviceReading> readings = _devices.values.toList()
      ..sort((DeviceReading a, DeviceReading b) => b.receivedAt.compareTo(a.receivedAt));
    final DeviceReading? latestReading = readings.isEmpty ? null : readings.first;
    final int onlineCount = readings.where((DeviceReading reading) => reading.hasFreshMetrics).length;
    final List<G1Reading> gatewayReadings =
        _g1Readings.where((G1Reading reading) => reading.isGateway).toList();
    final List<G1Reading> beaconReadings =
        _g1Readings.where((G1Reading reading) => !reading.isGateway).toList();
    final G1Reading? latestG1Reading = _g1Readings.isEmpty ? null : _g1Readings.first;
    final bool showingTzone = _activeSourceTab == SourceTab.tzone;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: EdgeInsets.zero,
          children: <Widget>[
            _HeroSection(
              isSocketConnected: _isSocketConnected,
              readingCount: showingTzone ? readings.length : _g1Readings.length,
              latestSeenAtText: showingTzone
                  ? (latestReading == null ? null : _formatDate(latestReading.receivedAt))
                  : (latestG1Reading == null ? null : latestG1Reading.timestampText),
              title: showingTzone ? 'Tzone Monitor' : 'Gateway ve Beacon',
              subtitle: showingTzone
                  ? 'Tzone isi sensoru verileri bu ekranda listelenir.'
                  : 'G1 gateway ve beacon kayitlari bu ekranda listelenir.',
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  _SourceTabs(
                    activeSourceTab: _activeSourceTab,
                    onChanged: (SourceTab tab) {
                      setState(() {
                        _activeSourceTab = tab;
                      });
                    },
                  ),
                  const SizedBox(height: 12),
                  _SummaryGrid(
                    cards: showingTzone
                        ? <_SummaryCardData>[
                            _SummaryCardData(
                              label: 'Kayit',
                              value: '${readings.length}',
                              note: 'Son 50 veri',
                            ),
                            _SummaryCardData(
                              label: 'Aktif Sensor',
                              value: '$onlineCount',
                              note: 'Olcumlu cihaz',
                            ),
                          ]
                        : <_SummaryCardData>[
                            _SummaryCardData(
                              label: 'Toplam',
                              value: '${_g1Readings.length}',
                              note: 'Son 50 kayit',
                            ),
                            _SummaryCardData(
                              label: 'Beacon',
                              value: '${beaconReadings.length}',
                              note: 'Algilanan beacon',
                            ),
                          ],
                  ),
                  const SizedBox(height: 12),
                  if (showingTzone)
                    _QuickStatsRow(
                      temperatureText: latestReading?.temperatureText ?? '-',
                      humidityText: latestReading?.humidityText ?? '-',
                    )
                  else
                    _QuickStatsRow(
                      temperatureText: latestG1Reading?.typeText ?? '-',
                      humidityText: latestG1Reading?.rssiText ?? '-',
                      firstLabel: 'Son Tip',
                      secondLabel: 'Son RSSI',
                    ),
                  const SizedBox(height: 12),
                  if (_errorMessage != null) ...<Widget>[
                    _MessageCard(message: _errorMessage!, color: const Color(0xFFB91C1C)),
                    const SizedBox(height: 12),
                  ],
                  _MessageCard(
                    message: _isSocketConnected
                        ? 'Canli baglanti aktif. Yeni veriler geldikce liste otomatik yenilenir.'
                        : 'Socket baglantisi bekleniyor. API ile 15 saniyede bir otomatik yenileme yapiliyor.',
                    color:
                        _isSocketConnected ? const Color(0xFF0F766E) : const Color(0xFF9A6700),
                  ),
                  const SizedBox(height: 14),
                  _SectionHeader(
                    title: showingTzone ? 'Canli Tzone Akisi' : 'Canli Gateway ve Beacon Akisi',
                    count: showingTzone ? readings.length : _g1Readings.length,
                  ),
                  const SizedBox(height: 10),
                  if (showingTzone && readings.isEmpty)
                    const _EmptyState(message: 'Henuz Tzone verisi yok')
                  else if (!showingTzone && _g1Readings.isEmpty)
                    const _EmptyState(message: 'Henuz gateway veya beacon verisi yok')
                  else if (showingTzone)
                    ...readings.map((DeviceReading reading) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _ReadingCard(reading: reading),
                        ))
                  else
                    Container(
                      constraints: BoxConstraints(
                        minHeight: 220,
                        maxHeight: gatewayListHeight,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Scrollbar(
                        thumbVisibility: true,
                        child: ListView.separated(
                          primary: false,
                          padding: EdgeInsets.zero,
                          itemCount: _g1Readings.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (BuildContext context, int index) {
                            final G1Reading reading = _g1Readings[index];

                            return _G1ReadingCard(
                              reading: reading,
                              gatewayCount: gatewayReadings.length,
                              beaconCount: beaconReadings.length,
                            );
                          },
                        ),
                      ),
                    ),
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
    required this.latestSeenAtText,
    required this.title,
    required this.subtitle,
  });

  final bool isSocketConnected;
  final int readingCount;
  final String? latestSeenAtText;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
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
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
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
                const SizedBox(height: 12),
            Text(
              title,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 6),
            Text(
              latestSeenAtText == null
                  ? subtitle
                  : 'Son veri: $latestSeenAtText',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.white.withOpacity(0.92),
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

enum SourceTab { tzone, g1 }

class _SourceTabs extends StatelessWidget {
  const _SourceTabs({
    required this.activeSourceTab,
    required this.onChanged,
  });

  final SourceTab activeSourceTab;
  final ValueChanged<SourceTab> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(
          child: _TabButton(
            label: 'Isi Sensorleri',
            isActive: activeSourceTab == SourceTab.tzone,
            onPressed: () => onChanged(SourceTab.tzone),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _TabButton(
            label: 'Gateway ve Beacon',
            isActive: activeSourceTab == SourceTab.g1,
            onPressed: () => onChanged(SourceTab.g1),
          ),
        ),
      ],
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({
    required this.label,
    required this.isActive,
    required this.onPressed,
  });

  final String label;
  final bool isActive;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: isActive ? const Color(0xFF0F766E) : Colors.white,
        foregroundColor: isActive ? Colors.white : const Color(0xFF102A43),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: isActive ? const Color(0xFF0F766E) : const Color(0xFFD8E1E8),
          ),
        ),
        elevation: 0,
      ),
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
              fontWeight: FontWeight.w700,
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
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final bool singleColumn = constraints.maxWidth < 360;
        final double aspectRatio = constraints.maxWidth < 420 ? 1.6 : 1.95;

        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: cards.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: singleColumn ? 1 : 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: singleColumn ? 2.7 : aspectRatio,
          ),
          itemBuilder: (BuildContext context, int index) {
            final _SummaryCardData card = cards[index];

            return Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFD8E1E8)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text(
                    card.label,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: const Color(0xFF627D98),
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    card.value,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          color: const Color(0xFF102A43),
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    card.note,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: const Color(0xFF627D98),
                        ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _QuickStatsRow extends StatelessWidget {
  const _QuickStatsRow({
    required this.temperatureText,
    required this.humidityText,
    this.firstLabel = 'Son Sicaklik',
    this.secondLabel = 'Son Nem',
  });

  final String temperatureText;
  final String humidityText;
  final String firstLabel;
  final String secondLabel;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: <Widget>[
        _StatPill(
          icon: Icons.thermostat,
          label: firstLabel,
          value: temperatureText,
          color: const Color(0xFFB45309),
        ),
        _StatPill(
          icon: Icons.water_drop,
          label: secondLabel,
          value: humidityText,
          color: const Color(0xFF0E7490),
        ),
      ],
    );
  }
}

class _StatPill extends StatelessWidget {
  const _StatPill({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD8E1E8)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: const Color(0xFF627D98),
                      fontWeight: FontWeight.w600,
                    ),
              ),
              const SizedBox(height: 1),
              Text(
                value,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: const Color(0xFF102A43),
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ],
          ),
        ],
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
    required this.isExpanded,
    required this.onToggleExpanded,
    required this.onConnectPressed,
  });

  final TextEditingController apiBaseUrlController;
  final TextEditingController socketUrlController;
  final bool isConnecting;
  final bool isSocketConnected;
  final bool isExpanded;
  final VoidCallback onToggleExpanded;
  final Future<void> Function() onConnectPressed;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            InkWell(
              onTap: onToggleExpanded,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: <Widget>[
                    Icon(
                      isSocketConnected ? Icons.wifi_tethering : Icons.wifi_tethering_error,
                      color: isSocketConnected ? const Color(0xFF0F766E) : const Color(0xFFB45309),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        isSocketConnected ? 'Baglanti ayarlari' : 'Baglanti ayarlari',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ),
                    Icon(
                      isExpanded ? Icons.expand_less : Icons.expand_more,
                      color: const Color(0xFF627D98),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              isSocketConnected ? 'Canli baglanti acik' : 'Baglanti bekleniyor',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: const Color(0xFF627D98),
                  ),
            ),
            if (isExpanded) ...<Widget>[
              const SizedBox(height: 12),
              TextField(
                controller: apiBaseUrlController,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'API Base URL',
                  hintText: 'https://your-backend-domain.up.railway.app',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: socketUrlController,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'Socket URL',
                  hintText: 'https://your-backend-domain.up.railway.app',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: isConnecting ? null : onConnectPressed,
                  child: Text(isConnecting ? 'Baglaniyor...' : 'Baglan ve Yenile'),
                ),
              ),
            ],
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});

  final String message;

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
            message,
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
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: const Color(0xFF102A43),
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
      width: 122,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.10),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 8),
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
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFF4F7FA),
        borderRadius: BorderRadius.circular(14),
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
          const SizedBox(height: 6),
          SelectableText(
            rawHex,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              color: Color(0xFF334155),
              height: 1.3,
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
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(14),
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
            const SizedBox(height: 12),
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
                  const SizedBox(width: 8),
                  _PrimaryMetric(
                    label: 'Nem',
                    value: reading.humidityText,
                    icon: Icons.water_drop,
                    color: const Color(0xFF0E7490),
                  ),
                  const SizedBox(width: 8),
                  _PrimaryMetric(
                    label: 'Pil',
                    value: reading.batteryText,
                    icon: Icons.battery_charging_full,
                    color: const Color(0xFF0F766E),
                  ),
                  const SizedBox(width: 8),
                  _PrimaryMetric(
                    label: 'Isik',
                    value: reading.lightText,
                    icon: Icons.light_mode,
                    color: const Color(0xFFCA8A04),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _MetricChip(label: 'Kaynak', value: reading.deviceTypeText),
                _MetricChip(label: 'RSSI', value: reading.rssiText),
                _MetricChip(label: 'Gateway', value: reading.gatewayText),
                _MetricChip(label: 'Gateway Free', value: reading.gatewayFreeText),
                _MetricChip(label: 'Gateway Load', value: reading.gatewayLoadText),
              ],
            ),
            if (reading.rawHex.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
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
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF2F8),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            '$label: ',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: const Color(0xFF627D98),
                  fontWeight: FontWeight.w600,
                ),
          ),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: const Color(0xFF102A43),
                  fontWeight: FontWeight.w700,
                ),
          ),
        ],
      ),
    );
  }
}

class _G1ReadingCard extends StatelessWidget {
  const _G1ReadingCard({
    required this.reading,
    required this.gatewayCount,
    required this.beaconCount,
  });

  final G1Reading reading;
  final int gatewayCount;
  final int beaconCount;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    reading.typeText,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
                Text(
                  reading.timestampText,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _MetricChip(label: 'MAC', value: reading.macText),
                _MetricChip(label: 'BLE Name', value: reading.bleNameText),
                _MetricChip(label: 'RSSI', value: reading.rssiText),
                _MetricChip(label: 'Gateway Free', value: reading.gatewayFreeText),
                _MetricChip(label: 'Gateway Load', value: reading.gatewayLoadText),
                _MetricChip(label: 'Gateway Kayit', value: '$gatewayCount'),
                _MetricChip(label: 'Beacon Kayit', value: '$beaconCount'),
              ],
            ),
            if (reading.rawData.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
              _RawHexBlock(rawHex: reading.rawData),
            ],
          ],
        ),
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

class G1Reading {
  G1Reading({
    required this.timestamp,
    required this.type,
    required this.mac,
    required this.bleNo,
    required this.bleName,
    required this.rssi,
    required this.rawData,
    required this.gatewayFree,
    required this.gatewayLoad,
  });

  final DateTime timestamp;
  final String? type;
  final String? mac;
  final int? bleNo;
  final String? bleName;
  final double? rssi;
  final String rawData;
  final double? gatewayFree;
  final double? gatewayLoad;

  bool get isGateway => (type ?? '').trim().toLowerCase() == 'gateway';
  String get timestampText => _formatDate(timestamp);
  String get typeText => (type == null || type!.trim().isEmpty) ? 'Unknown' : type!.trim();
  String get macText => mac == null || mac!.trim().isEmpty ? '-' : mac!.trim();
  String get bleNameText => bleName == null || bleName!.trim().isEmpty ? '-' : bleName!.trim();
  String get rssiText => rssi == null ? '-' : '${rssi!.toStringAsFixed(0)} dBm';
  String get gatewayFreeText =>
      gatewayFree == null ? '-' : '${gatewayFree!.toStringAsFixed(0)} MB';
  String get gatewayLoadText => gatewayLoad == null ? '-' : gatewayLoad!.toStringAsFixed(2);

  factory G1Reading.fromApi(Map<String, dynamic> json) {
    return G1Reading(
      timestamp: DateTime.tryParse((json['timestamp'] ?? '').toString()) ?? DateTime.now(),
      type: _parseString(json['type']),
      mac: _parseString(json['mac']),
      bleNo: _parseInt(json['bleNo']),
      bleName: _parseString(json['bleName']),
      rssi: _parseNumber(json['rssi']),
      rawData: (json['rawData'] ?? '').toString(),
      gatewayFree: _parseNumber(json['gatewayFree']),
      gatewayLoad: _parseNumber(json['gatewayLoad']),
    );
  }

  static String? _parseString(dynamic value) {
    if (value == null) {
      return null;
    }

    final String text = value.toString().trim();
    return text.isEmpty ? null : text;
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

  static int? _parseInt(dynamic value) {
    if (value == null) {
      return null;
    }

    if (value is int) {
      return value;
    }

    return int.tryParse(value.toString());
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
