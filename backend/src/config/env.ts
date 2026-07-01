import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),
  TZONE_TCP_HOST: z.string().default('0.0.0.0'),
  TZONE_TCP_PORT: z.coerce.number().int().positive().default(18801),
  TZONE_ONLINE_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
  G1_MQTT_URL: z.string().trim().optional(),
  G1_MQTT_CLIENT_ID: z.string().default('realtime-data-logger-g1'),
  G1_MQTT_USERNAME: z.string().trim().optional(),
  G1_MQTT_PASSWORD: z.string().trim().optional(),
  G1_MQTT_STATUS_TOPIC: z.string().default('/gw/+/status'),
  G1_MQTT_QOS: z.coerce.number().int().min(0).max(2).default(0),
  G1_MQTT_KEEPALIVE: z.coerce.number().int().positive().default(30),
  DATABASE_URL: z.string().trim().optional(),
  SHADOW_DATABASE_URL: z.string().trim().optional(),
  WEB_SOCKET_CORS_ORIGIN: z.string().default('*'),
  FIREBASE_PROJECT_ID: z.string().trim().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().trim().optional(),
  FIREBASE_PRIVATE_KEY: z.string().trim().optional(),
  FIREBASE_ALERT_TOPIC: z.string().trim().default('critical-temperature-alerts'),
  TZONE_CRITICAL_TEMP_C: z.coerce.number().default(40),
  TZONE_CRITICAL_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(30)
});

export const env = envSchema.parse(process.env);
