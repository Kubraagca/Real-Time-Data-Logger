import { Request, Response, Router, text } from 'express';

import { parseG1HttpPayload } from './g1.mqtt.parser';
import { tzoneService } from '../tzone/tzone.service';

const router = Router();

async function handleG1HttpIngest(request: Request, response: Response) {
  const receivedAt = new Date();
  const remoteAddress = request.socket.remoteAddress ?? 'http';
  const remotePort = request.socket.remotePort ?? 0;

  try {
    const readings = parseG1HttpPayload(request.body, receivedAt, remoteAddress, remotePort);

    for (const reading of readings) {
      await tzoneService.ingestReading(reading);
    }

    response.status(200).json({
      accepted: true,
      readings: readings.length
    });
  } catch (error) {
    console.error('[G1:HTTP] Failed to parse or ingest payload.', error);

    // G1 keeps posting only when it receives HTTP 200.
    response.status(200).json({
      accepted: false,
      readings: 0
    });
  }
}

router.post('/api/g1/http', text({ type: '*/*' }), async (request, response) => {
  await handleG1HttpIngest(request, response);
});

router.post('/gw/:gatewayMac/status', text({ type: '*/*' }), async (request, response) => {
  await handleG1HttpIngest(request, response);
});

router.get('/api/g1/readings/latest', async (request, response, next) => {
  try {
    const limit = Number.parseInt(String(request.query.limit ?? '50'), 10);
    const readings = await tzoneService.getG1LatestReadings(Number.isInteger(limit) ? limit : 50);
    response.json(readings);
  } catch (error) {
    next(error);
  }
});

router.get('/api/g1/devices', async (_request, response, next) => {
  try {
    const devices = await tzoneService.getDevices('g1');
    response.json(devices);
  } catch (error) {
    next(error);
  }
});

router.get('/api/g1/devices/:imei/readings', async (request, response, next) => {
  try {
    const limit = Number.parseInt(String(request.query.limit ?? '100'), 10);
    const readings = await tzoneService.getDeviceReadings(
      'g1',
      request.params.imei,
      Number.isInteger(limit) ? limit : 100
    );

    response.json(readings);
  } catch (error) {
    next(error);
  }
});

export default router;
