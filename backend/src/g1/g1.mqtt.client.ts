import mqtt, { MqttClient } from 'mqtt';

import { env } from '../config/env';
import { tzoneService } from '../tzone/tzone.service';
import { parseG1MqttPayload } from './g1.mqtt.parser';

export function createG1MqttClient() {
  let client: MqttClient | null = null;

  return {
    start() {
      if (!env.G1_MQTT_URL) {
        console.log('[G1:MQTT] Skipping startup because G1_MQTT_URL is not configured.');
        return;
      }

      client = mqtt.connect(env.G1_MQTT_URL, {
        clientId: env.G1_MQTT_CLIENT_ID,
        username: env.G1_MQTT_USERNAME,
        password: env.G1_MQTT_PASSWORD,
        keepalive: env.G1_MQTT_KEEPALIVE,
        clean: true,
        reconnectPeriod: 5_000
      });

      client.on('connect', () => {
        console.log(`[G1:MQTT] Connected to broker ${env.G1_MQTT_URL}`);

        client?.subscribe(
          env.G1_MQTT_STATUS_TOPIC,
          { qos: env.G1_MQTT_QOS as 0 | 1 | 2 },
          (error: Error | null) => {
          if (error) {
            console.error('[G1:MQTT] Failed to subscribe.', error);
            return;
          }

          console.log(`[G1:MQTT] Subscribed to ${env.G1_MQTT_STATUS_TOPIC}`);
          }
        );
      });

      client.on('message', async (_topic: string, payload: Buffer) => {
        const readings = parseG1MqttPayload(payload, new Date());

        for (const reading of readings) {
          try {
            await tzoneService.ingestReading(reading);
          } catch (error) {
            console.error('[G1:MQTT] Failed to ingest reading.', error);
          }
        }
      });

      client.on('reconnect', () => {
        console.log('[G1:MQTT] Reconnecting to broker...');
      });

      client.on('error', (error: Error) => {
        console.error('[G1:MQTT] Client error.', error);
      });

      client.on('close', () => {
        console.log('[G1:MQTT] Connection closed.');
      });
    },
    close() {
      client?.end(true);
      client = null;
    }
  };
}
