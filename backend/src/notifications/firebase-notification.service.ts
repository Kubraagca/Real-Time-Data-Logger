import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

import { env } from '../config/env';
import { TzoneReadingPayload } from '../tzone/tzone.types';

class FirebaseNotificationService {
  private readonly lastAlertAtByDevice = new Map<string, number>();
  private readonly channelId = 'critical_temperature_alerts';
  private readonly firebaseEnabled =
    Boolean(env.FIREBASE_PROJECT_ID) &&
    Boolean(env.FIREBASE_CLIENT_EMAIL) &&
    Boolean(env.FIREBASE_PRIVATE_KEY);

  start() {
    if (!this.firebaseEnabled || getApps().length > 0) {
      return;
    }

    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });

    console.log('[FCM] Firebase Admin initialized');
  }

  async notifyIfCriticalTemperature(payload: TzoneReadingPayload) {
    if (!this.firebaseEnabled || payload.source !== 'tzone' || payload.temperature === null) {
      return;
    }

    if (payload.temperature < env.TZONE_CRITICAL_TEMP_C) {
      return;
    }

    const deviceKey = payload.imei ?? `unknown:${payload.rawHex}`;
    const now = payload.receivedAt.getTime();
    const cooldownMs = env.TZONE_CRITICAL_ALERT_COOLDOWN_MINUTES * 60 * 1000;
    const lastAlertAt = this.lastAlertAtByDevice.get(deviceKey);

    if (lastAlertAt !== undefined && now - lastAlertAt < cooldownMs) {
      return;
    }

    this.start();

    if (getApps().length === 0) {
      return;
    }

    try {
      const messageId = await getMessaging().send({
        topic: env.FIREBASE_ALERT_TOPIC,
        notification: {
          title: 'Kritik Sicaklik',
          body: `Tzone sicakligi ${payload.temperature.toFixed(1)} C oldu.`
        },
        data: {
          type: 'critical_temperature',
          imei: payload.imei ?? '',
          temperature: payload.temperature.toFixed(1),
          threshold: env.TZONE_CRITICAL_TEMP_C.toString(),
          receivedAt: payload.receivedAt.toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            channelId: this.channelId,
            sound: 'default'
          }
        }
      });

      this.lastAlertAtByDevice.set(deviceKey, now);
      console.log(
        `[FCM] Critical notification sent. imei=${payload.imei ?? 'unknown'} temp=${payload.temperature.toFixed(1)} topic=${env.FIREBASE_ALERT_TOPIC} messageId=${messageId}`
      );
    } catch (error) {
      console.error('Failed to send Firebase notification', error);
    }
  }

  async sendTestNotification() {
    this.start();

    if (getApps().length === 0) {
      throw new Error('Firebase Admin is not initialized. Check backend/.env Firebase values.');
    }

    const messageId = await getMessaging().send({
      topic: env.FIREBASE_ALERT_TOPIC,
      notification: {
        title: 'Kritik Sicaklik Test',
        body: 'Bu bir test bildirimidir.'
      },
      data: {
        type: 'critical_temperature_test',
        threshold: env.TZONE_CRITICAL_TEMP_C.toString(),
        receivedAt: new Date().toISOString()
      },
      android: {
        priority: 'high'
      }
    });

    console.log(`[FCM] Test notification sent. topic=${env.FIREBASE_ALERT_TOPIC} messageId=${messageId}`);

    return {
      ok: true,
      topic: env.FIREBASE_ALERT_TOPIC,
      messageId
    };
  }
}

export const firebaseNotificationService = new FirebaseNotificationService();
