import http from 'node:http';

import { Server as SocketIOServer } from 'socket.io';

import app from './app';
import { env } from './config/env';
import { disconnectPrisma, isDatabaseConfigured } from './config/prisma';
import { createG1MqttClient } from './g1/g1.mqtt.client';
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
  const g1MqttClient = createG1MqttClient();
  tcpServer.listen();
  g1MqttClient.start();

  httpServer.listen(env.PORT, env.HTTP_HOST, () => {
    console.log(`HTTP API listening on ${env.HTTP_HOST}:${env.PORT}`);
  });

  if (!isDatabaseConfigured) {
    console.warn('DATABASE_URL is not configured. Running in TCP/API-only mode without persistence.');
  }

  const shutdown = async () => {
    await disconnectPrisma();
    io.close();
    g1MqttClient.close();
    tcpServer.close();
    httpServer.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(async (error) => {
  console.error('Failed to start backend', error);
  await disconnectPrisma();
  process.exit(1);
});
