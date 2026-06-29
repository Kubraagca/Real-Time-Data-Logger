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

export default router;
