import { Router } from 'express';

import { firebaseNotificationService } from '../notifications/firebase-notification.service';
import { tzoneService } from './tzone.service';

const router = Router();

router.get('/api/tzone/readings/latest', async (request, response, next) => {
  try {
    const limit = Number.parseInt(String(request.query.limit ?? '50'), 10);
    const readings = await tzoneService.getLatestReadings(
      'tzone',
      Number.isInteger(limit) ? limit : 50
    );
    response.json(readings);
  } catch (error) {
    next(error);
  }
});

router.get('/api/tzone/devices', async (_request, response, next) => {
  try {
    const devices = await tzoneService.getDevices('tzone');
    response.json(devices);
  } catch (error) {
    next(error);
  }
});

router.get('/api/tzone/devices/:imei/readings', async (request, response, next) => {
  try {
    const limit = Number.parseInt(String(request.query.limit ?? '100'), 10);
    const readings = await tzoneService.getDeviceReadings(
      'tzone',
      request.params.imei,
      Number.isInteger(limit) ? limit : 100
    );

    response.json(readings);
  } catch (error) {
    next(error);
  }
});

router.post('/api/tzone/notifications/test', async (_request, response, next) => {
  try {
    const result = await firebaseNotificationService.sendTestNotification();
    response.json(result);
  } catch (error) {
    console.error('[FCM] Test notification failed', error);
    next(error);
  }
});

export default router;
