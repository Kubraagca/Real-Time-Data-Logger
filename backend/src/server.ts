import http from 'node:http';

import { Server as SocketIOServer } from 'socket.io';

import app from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { tzoneGateway } from './tzone/tzone.gateway';
import { createTzoneTcpServer } from './tzone/tzone.tcp.server';

async function bootstrap() {
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.WEB_SOCKET_CORS_ORIGIN === '*' ? true : env.WEB_SOCKET_CORS_ORIGIN.split(','),
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`[WS] client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[WS] client disconnected: ${socket.id}`);
    });
  });

  tzoneGateway.attach(io);

  const tcpServer = createTzoneTcpServer();
  tcpServer.listen();

  httpServer.listen(env.PORT, () => {
    console.log(`HTTP API listening on port ${env.PORT}`);
  });

  const shutdown = async () => {
    await prisma.$disconnect();
    io.close();
    tcpServer.close();
    httpServer.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(async (error) => {
  console.error('Failed to start backend', error);
  await prisma.$disconnect();
  process.exit(1);
});
