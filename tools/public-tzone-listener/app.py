#!/usr/bin/env python3
import json
import os
import signal
import socketserver
import sys
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Optional


TZONE_START = b"TZ"
BASIC_DATA_MESSAGE_TYPE = 0x2424
TT18_4G_M_HARDWARE_TYPE = 0x0407
TT18_4G_S_HARDWARE_TYPE = 0x0409
STOP_SYMBOL = 0x0D0A


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hex_upper(data: bytes) -> str:
    return data.hex().upper()


def ascii_preview(data: bytes) -> str:
    return "".join(chr(b) if 32 <= b <= 126 else "." for b in data)


def read_u16_be(data: bytes, offset: int) -> Optional[int]:
    if offset + 2 > len(data):
        return None
    return int.from_bytes(data[offset : offset + 2], "big")


def decode_packed_imei(data: bytes, offset: int) -> Optional[str]:
    if offset + 8 > len(data):
        return None
    imei = data[offset : offset + 8].hex()[1:]
    return imei if len(imei) == 15 else None


def decode_rtc(data: bytes, offset: int) -> Optional[str]:
    if offset + 6 > len(data):
        return None
    year = 2000 + data[offset]
    month = data[offset + 1]
    day = data[offset + 2]
    hour = data[offset + 3]
    minute = data[offset + 4]
    second = data[offset + 5]
    try:
        dt = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    except ValueError:
        return None
    return dt.isoformat()


def decode_battery(raw_value: Optional[int]) -> Optional[float]:
    if raw_value is None:
        return None
    return round(raw_value / 100, 2)


def decode_temperature(raw_value: Optional[int]) -> Optional[float]:
    if raw_value is None or raw_value == 0x8000:
        return None
    if (raw_value & 0x8000) != 0:
        return None
    is_negative = (raw_value & 0x4000) != 0
    magnitude = raw_value & 0x3FFF
    value = magnitude / 10
    return round(-value if is_negative else value, 1)


def decode_humidity(raw_value: Optional[int]) -> Optional[float]:
    if raw_value is None or raw_value == 0xFFFF:
        return None
    if (raw_value & 0x8000) != 0:
        return None
    return round((raw_value & 0x7FFF) / 10, 1)


def decode_light(raw_value: Optional[int]) -> Optional[int]:
    if raw_value is None:
        return None
    return raw_value & 0x01


def looks_like_tls(data: bytes) -> bool:
    return len(data) >= 3 and data[0] == 0x16 and data[1] == 0x03


def build_ack(message_id: int) -> bytes:
    return f"@ACK,{message_id}#\r\n".encode("utf-8")


@dataclass
class ParsedPacket:
    protocol: str
    imei: Optional[str] = None
    hardware_type: Optional[str] = None
    message_type: Optional[str] = None
    rtc_time: Optional[str] = None
    alarm_type: Optional[str] = None
    button_pressed: Optional[bool] = None
    sensor_abnormal: Optional[bool] = None
    threshold_alarm: Optional[bool] = None
    low_battery: Optional[bool] = None
    charging: Optional[bool] = None
    work_mode: Optional[str] = None
    csq: Optional[int] = None
    internet_connected: Optional[bool] = None
    gprs_registered: Optional[bool] = None
    roaming: Optional[bool] = None
    gsm_registered: Optional[bool] = None
    sim_detected: Optional[bool] = None
    gsm_started: Optional[bool] = None
    battery: Optional[float] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light: Optional[int] = None
    message_id: Optional[int] = None
    note: Optional[str] = None


def decode_alarm_type(value: int) -> str:
    mapping = {
        0xAA: "interval-data",
        0x10: "low-battery-alarm",
        0xA0: "temp-humidity-over-threshold",
        0xA1: "temp-humidity-sensor-abnormal",
    }
    return mapping.get(value, f"0x{value:02X}")


def decode_work_mode(value: int) -> str:
    mode = (value >> 6) & 0b11
    mapping = {
        0b00: "normal",
        0b01: "flight",
    }
    return mapping.get(mode, f"reserved-{mode}")


def parse_tzone_packet(data: bytes) -> ParsedPacket:
    if looks_like_tls(data):
        return ParsedPacket(protocol="tls", note="TLS/HTTPS handshake, cihaz verisi degil")

    if len(data) < 12 or not data.startswith(TZONE_START):
        return ParsedPacket(protocol="unknown", note="TZ baslikli gecerli cihaz paketi degil")

    stop_symbol = read_u16_be(data, len(data) - 2)
    if stop_symbol != STOP_SYMBOL:
        return ParsedPacket(protocol="unknown", note="Paket sonu 0D0A degil")

    packet_length = read_u16_be(data, 2)
    message_type = read_u16_be(data, 4)
    hardware_type = read_u16_be(data, 6)
    imei = decode_packed_imei(data, 12)
    rtc_time = decode_rtc(data, 20)

    parsed = ParsedPacket(
        protocol="tzone-binary",
        imei=imei,
        hardware_type=f"0x{hardware_type:04X}" if hardware_type is not None else None,
        message_type=f"0x{message_type:04X}" if message_type is not None else None,
        rtc_time=rtc_time,
    )

    if packet_length is None or packet_length + 6 != len(data):
        parsed.note = "Paket boyu beklenenle uyusmuyor"
        return parsed

    if message_type != BASIC_DATA_MESSAGE_TYPE:
        parsed.note = "Basic data (2424) degil"
        return parsed

    if hardware_type not in (TT18_4G_M_HARDWARE_TYPE, TT18_4G_S_HARDWARE_TYPE):
        parsed.note = "Beklenen TT18 4G hardware tipi degil"
        return parsed

    cursor = 26

    gps_length = read_u16_be(data, cursor)
    if gps_length is None:
        parsed.note = "GPS uzunlugu okunamadi"
        return parsed
    cursor += 2 + gps_length

    lbs_length = read_u16_be(data, cursor)
    if lbs_length is None:
        parsed.note = "LBS uzunlugu okunamadi"
        return parsed
    cursor += 2 + lbs_length

    status_length = read_u16_be(data, cursor)
    if status_length is None:
        parsed.note = "Status uzunlugu okunamadi"
        return parsed

    cursor += 2
    status_start = cursor

    if status_length == 0:
        parsed.note = "Status data yok, sicaklik/nem bu pakette gelmemis"
        parsed.message_id = read_u16_be(data, len(data) - 6)
        return parsed

    if status_start + status_length > len(data):
        parsed.note = "Status data paketi tasiyor"
        return parsed

    if status_length >= 11:
        alarm_type = data[status_start]
        terminal_info = data[status_start + 1]
        network_signal = data[status_start + 2]
        network_state = data[status_start + 3]

        parsed.alarm_type = decode_alarm_type(alarm_type)
        parsed.work_mode = decode_work_mode(terminal_info)
        parsed.button_pressed = bool(terminal_info & (1 << 4))
        parsed.sensor_abnormal = bool(terminal_info & (1 << 3))
        parsed.threshold_alarm = bool(terminal_info & (1 << 2))
        parsed.low_battery = bool(terminal_info & (1 << 1))
        parsed.charging = bool(terminal_info & (1 << 0))
        parsed.csq = network_signal
        parsed.internet_connected = bool(network_state & (1 << 5))
        parsed.gprs_registered = bool(network_state & (1 << 4))
        parsed.roaming = bool(network_state & (1 << 3))
        parsed.gsm_registered = bool(network_state & (1 << 2))
        parsed.sim_detected = bool(network_state & (1 << 1))
        parsed.gsm_started = bool(network_state & (1 << 0))
        parsed.battery = decode_battery(read_u16_be(data, status_start + 4))
        parsed.temperature = decode_temperature(read_u16_be(data, status_start + 6))
        parsed.humidity = decode_humidity(read_u16_be(data, status_start + 8))
        parsed.light = decode_light(data[status_start + 10])
        parsed.message_id = read_u16_be(data, len(data) - 6)
        parsed.note = "Gecerli TT18 basic data paketi"
        return parsed

    parsed.note = f"Status data boyu beklenenden kisa: {status_length}"
    parsed.message_id = read_u16_be(data, len(data) - 6)
    return parsed


class TzoneTcpHandler(socketserver.BaseRequestHandler):
    ack_enabled = False

    def handle(self) -> None:
        peer = f"{self.client_address[0]}:{self.client_address[1]}"
        print(f"[CONNECT] {peer}", flush=True)

        while True:
            data = self.request.recv(4096)
            if not data:
                break

            received_at = utc_now_iso()
            print(
                "[RAW]",
                json.dumps(
                    {
                        "remoteAddress": self.client_address[0],
                        "remotePort": self.client_address[1],
                        "receivedAt": received_at,
                        "rawHex": hex_upper(data),
                        "asciiPreview": ascii_preview(data),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )

            parsed = parse_tzone_packet(data)
            print("[PARSED]", json.dumps(asdict(parsed), ensure_ascii=False), flush=True)

            if parsed.protocol == "tzone-binary":
                print(
                    "[STATUS]",
                    json.dumps(
                        {
                            "imei": parsed.imei,
                            "alarmType": parsed.alarm_type,
                            "buttonPressed": parsed.button_pressed,
                            "charging": parsed.charging,
                            "lowBattery": parsed.low_battery,
                            "internetConnected": parsed.internet_connected,
                            "simDetected": parsed.sim_detected,
                            "gsmStarted": parsed.gsm_started,
                            "gsmRegistered": parsed.gsm_registered,
                            "gprsRegistered": parsed.gprs_registered,
                            "workMode": parsed.work_mode,
                            "temperature": parsed.temperature,
                            "humidity": parsed.humidity,
                            "battery": parsed.battery,
                            "light": parsed.light,
                            "messageId": parsed.message_id,
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )

            if self.ack_enabled and parsed.message_id is not None:
                ack = build_ack(parsed.message_id)
                self.request.sendall(ack)
                print(f"[ACK] {ack.decode('utf-8').strip()}", flush=True)

        print(f"[CLOSE] {peer}", flush=True)


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def read_bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    host = os.getenv("LISTENER_HOST", "0.0.0.0")
    port = int(os.getenv("TZONE_TCP_PORT", "18801"))
    ack_enabled = read_bool_env("TZONE_ACK", True)

    TzoneTcpHandler.ack_enabled = ack_enabled
    server = ThreadedTCPServer((host, port), TzoneTcpHandler)
    stop_event = threading.Event()

    def shutdown_handler(*_args: object) -> None:
        if stop_event.is_set():
            return
        stop_event.set()
        print("[SERVER] shutting down...", flush=True)
        server.shutdown()
        server.server_close()

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    print(f"[SERVER] listening on {host}:{port} ack={ack_enabled}", flush=True)
    print("[SERVER] Gercek cihaz paketi icin rawHex baslangici 545A olmali.", flush=True)
    print("[SERVER] 160301 ile baslayan veri TLS'tir, cihaz sicaklik paketi degildir.", flush=True)

    try:
        server.serve_forever()
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
