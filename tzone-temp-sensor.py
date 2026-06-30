import socket
import struct
from datetime import datetime

HOST = "reseau.proxy.rlwy.net"
PORT  = 40715


def build_packet(temperature: float, humidity: float) -> bytes:
    """
    Protokol yapısı (toplam 88 byte):
      [0-1]   TZ           – start marker
      [2-3]   packetLength – toplam - 6 (start + length alanı + CRLF hariç)
      [4-5]   $$           – mesaj tipi
      [6-7]   hw_type
      [8-11]  firmware
      [12-19] IMEI (8 byte BCD)
      [20-25] RTC (yıl-2000, ay, gün, saat, dk, sn)  ← anlık zaman
      [26-27] GPS blok uzunluğu (19)
      [28-46] GPS bloğu
                [28]    GPS status
                [29-34] UTC zaman                     ← anlık zaman
                [35-38] Enlem int32 BE
                [39-42] Boylam int32 BE
                [43-44] Yön
                [45-46] Hız
      [47-48] LBS blok uzunluğu (20)
      [49-68] LBS bloğu (sabit baz istasyonu verisi)
      [69-70] Status blok uzunluğu (11)
      [71-81] Status bloğu
                [71]    dataType
                [72]    terminalInfo
                [73]    sinyal gücü
                [74]    ağ durumu
                [75-76] batarya
                [77-78] sıcaklık signed int16 / 10   ← kullanıcı girer
                [79-80] nem      uint16   / 10        ← kullanıcı girer
                [81]    ışık sensörü
      [82-83] message ID
      [84-85] CRC16 (sunucu doğrulamıyor)
      [86-87] 0D 0A
    """
    now = datetime.now()

    rtc_bytes = bytes([
        now.year - 2000, now.month, now.day,
        now.hour, now.minute, now.second,
    ])

    gps_block = (
        bytes([0x01])                       +  # GPS status: geçerli
        rtc_bytes                           +  # UTC zaman (aynı an)
        bytes([0x02, 0x71, 0xA4, 0x89])    +  # Enlem  → 41.002121°N
        bytes([0x01, 0xBC, 0xE2, 0x58])    +  # Boylam → 28.xxxxxx°E
        bytes([0x00, 0x00])                +  # Yön
        bytes([0x00, 0x00])                   # Hız
    )  # 19 byte

    lbs_data = bytes([
        0x01,                               # baz istasyonu sayısı
        0xD2,                               # sinyal gücü
        0x02, 0x86,                         # MCC (Türkiye)
        0x00, 0x01,                         # MNC
        0x17, 0x05,                         # LAC
        0x00, 0xD4, 0x34, 0x16,            # Cell ID
        0x01, 0x78, 0x00, 0x06,            # ek LBS verisi
        0x73, 0x59, 0x0B, 0x38,            # ek LBS verisi
    ])  # 20 byte

    temp_raw = int(round(temperature * 10))
    hum_raw  = int(round(humidity  * 10))

    status_data = (
        bytes([0xAA])                      +  # dataType
        bytes([0x10])                      +  # terminalInfo
        bytes([0x1C])                      +  # sinyal gücü
        bytes([0x37])                      +  # ağ durumu
        bytes([0x01, 0x5E])               +  # batarya (3.50 V)
        struct.pack(">h", temp_raw)        +  # sıcaklık (signed int16 BE)
        struct.pack(">H", hum_raw)         +  # nem (uint16 BE)
        bytes([0x01])                         # ışık sensörü
    )  # 11 byte

    payload = (
        bytes([0x24, 0x24])               +  # mesaj tipi $$
        bytes([0x04, 0x09])               +  # HW type
        bytes([0x03, 0x09, 0x00, 0x00])   +  # firmware
        bytes([0x01, 0x80, 0x52, 0x30,
               0x00, 0x00, 0x03, 0x08])   +  # IMEI
        rtc_bytes                         +  # RTC
        struct.pack(">H", len(gps_block)) +
        gps_block                         +
        struct.pack(">H", len(lbs_data))  +
        lbs_data                          +
        struct.pack(">H", len(status_data)) +
        status_data                       +
        struct.pack(">H", 0x0001)            # message ID
    )

    checksum   = bytes([0x17, 0x6C])         # CRC16 (sunucu doğrulamıyor)
    terminator = bytes([0x0D, 0x0A])

    # packetLength = total - start_marker(2) - length_field(2) - terminator(2)
    packet_length = struct.pack(">H", len(payload) + len(checksum))

    return bytes([0x54, 0x5A]) + packet_length + payload + checksum + terminator


def prompt_float(label: str, unit: str, min_val: float, max_val: float) -> float:
    while True:
        try:
            val = float(input(f"{label} ({unit}): ").strip())
            if min_val <= val <= max_val:
                return val
            print(f"  Error: {min_val} ile {max_val} arasında bir değer girin.")
        except ValueError:
            print("  Error: Geçersiz sayı.")


def main():
    print("=" * 45)
    print("  TZ Temperature Sensor Simulator")
    print("=" * 45)

    temperature = prompt_float("Temperature", "°C, örn: 25.1", -40.0, 85.0)
    humidity    = prompt_float("Humidity   ", "%,  örn: 53.0",   0.0, 100.0)

    packet = build_packet(temperature, humidity)
    now    = datetime.now()

    print()
    print(f"  Time     : {now.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Temperature  : {temperature} °C  →  raw {int(round(temperature * 10))}")
    print(f"  Humidity       : {humidity} %   →  raw {int(round(humidity * 10))}")
    print(f"  Packet     : {packet.hex('-').upper()}")
    print(f"  Size     : {len(packet)} byte")
    print()

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(10)
            s.connect((HOST, PORT))
            print(f"  Connection  : {HOST}:{PORT}  ✓")
            s.sendall(packet)
            print("  Send  : Completed ✓")

            s.settimeout(5)
            try:
                response = s.recv(4096)
                print(f"  Response  : {response.hex('-').upper()}  ({len(response)} byte)")
            except socket.timeout:
                print("  Response  : None (5s timeout)")
    except (socket.timeout, ConnectionRefusedError, OSError) as exc:
        print(f"  Connection error: {exc}")


if __name__ == "__main__":
    main()
