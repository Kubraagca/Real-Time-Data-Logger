import { PrismaClient } from '@prisma/client';

import { env } from './env';

export const isDatabaseConfigured = Boolean(env.DATABASE_URL);

export const prisma = isDatabaseConfigured
  ? new PrismaClient({
      datasources: {
        db: {
          url: env.DATABASE_URL
        }
      }
    })
  : null;

export async function disconnectPrisma(): Promise<void> {
  if (prisma !== null) {
    await prisma.$disconnect();
  }
}
