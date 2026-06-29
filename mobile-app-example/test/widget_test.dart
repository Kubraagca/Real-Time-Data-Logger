import 'package:flutter_test/flutter_test.dart';

import 'package:tzone_mobile_example/main.dart';

void main() {
  testWidgets('Gateway monitor renders connection fields', (WidgetTester tester) async {
    await tester.pumpWidget(const TzoneMobileApp());

    expect(find.text('Gateway Monitor'), findsWidgets);
    expect(find.text('API Base URL'), findsOneWidget);
    expect(find.text('Socket URL'), findsOneWidget);
    expect(find.text('Baglan ve Yenile'), findsOneWidget);
  });
}
