import net from 'node:net';

import { env } from '../config/env';
import { buildTzoneAck, buildTzoneRawLog, parseTzonePacket } from './tzone.parser';
import { tzoneService } from './tzone.service';

export function createTzoneTcpServer() {
  const server = net.createServer((socket) => {
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const remotePort = socket.remotePort ?? 0;

    console.log(`[TZONE:CONNECT] ${remoteAddress}:${remotePort}`);

    socket.on('data', async (buffer) => {
      const receivedAt = new Date();

      const rawLog = buildTzoneRawLog(buffer, remoteAddress, remotePort, receivedAt);
      console.log('[TZONE:RAW]', JSON.stringify(rawLog));

      const parsed = parseTzonePacket(buffer, receivedAt);

      if (parsed.packetIndex !== null) {
        socket.write(buildTzoneAck(parsed.packetIndex));
      }

      try {
        await tzoneService.ingestReading({
          ...parsed,
          remoteAddress,
          remotePort
        });
      } catch (error) {
        console.error('[TZONE:DB]', error);
      }
    });

    socket.on('error', (error) => {
      console.error('[TZONE:SOCKET]', error);
    });

    socket.on('close', (hadError) => {
      console.log(`[TZONE:CLOSE] ${remoteAddress}:${remotePort} hadError=${hadError}`);
    });
  });

  server.on('error', (error) => {
    console.error('[TZONE:SERVER]', error);
  });

  return {
    listen() {
      server.listen(env.TZONE_TCP_PORT, env.TZONE_TCP_HOST, () => {
        console.log(
          `TZONE TCP server listening on ${env.TZONE_TCP_HOST}:${env.TZONE_TCP_PORT}`
        );
      });
    },
    close() {
      server.close();
    }
  };
}
