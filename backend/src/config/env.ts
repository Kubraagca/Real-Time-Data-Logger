import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),
  TZONE_TCP_HOST: z.string().default('0.0.0.0'),
  TZONE_TCP_PORT: z.coerce.number().int().positive().default(18801),
  DATABASE_URL: z.string().trim().optional(),
  SHADOW_DATABASE_URL: z.string().trim().optional(),
  WEB_SOCKET_CORS_ORIGIN: z.string().default('*')
});

export const env = envSchema.parse(process.env);
