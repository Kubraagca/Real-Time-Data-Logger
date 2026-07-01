import { isDatabaseConfigured } from './config/prisma';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

import { env } from './config/env';
import g1HttpRoutes from './g1/g1.http.routes';
import tzoneRoutes from './tzone/tzone.routes';

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'realtime-data-logger-backend',
    databaseConfigured: isDatabaseConfigured,
    g1MqttEnabled: Boolean(env.G1_MQTT_URL),
    g1HttpEnabled: true
  });
});

app.use(g1HttpRoutes);
app.use(tzoneRoutes);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[HTTP] Unhandled error', error);

    const message = error instanceof Error ? error.message : 'Internal Server Error';
    response.status(500).json({ error: message });
  }
);

export default app;
