import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  TZONE_TCP_HOST: z.string().default('0.0.0.0'),
  TZONE_TCP_PORT: z.coerce.number().int().positive().default(18801),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SHADOW_DATABASE_URL: z.string().min(1, 'SHADOW_DATABASE_URL is required'),
  WEB_SOCKET_CORS_ORIGIN: z.string().default('*')
});

export const env = envSchema.parse(process.env);
