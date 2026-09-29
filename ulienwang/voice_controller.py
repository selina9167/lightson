"""Ameba Mini voice LED controller.

The browser performs speech recognition. This Python process serves the page,
owns the serial port, prints every event, and relays commands to the board.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

try:
    import serial
except ImportError:  # Reported clearly in main unless --no-serial is used.
    serial = None

try:
    import pythoncom
    import win32com.client
except ImportError:  # Windows speech remains optional on non-Windows hosts.
    pythoncom = None
    win32com = None


PROJECT_ROOT = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 64 * 1024
VALID_COMMANDS = {
    "LEFT_ON",
    "LEFT_OFF",
    "RIGHT_ON",
    "RIGHT_OFF",
    "ALL_ON",
    "ALL_OFF",
    "BLINK_3",
    "STATUS",
}
STATE_PATTERN = re.compile(r"^STATE blue=([01]) green=([01])$")


def validate_speech_request(payload: dict[str, Any]) -> tuple[str, str]:
    text = str(payload.get("text", "")).strip()
    language = str(payload.get("language", "zh-TW"))
    if not text or len(text) > 120 or any(character in text for character in "\r\n"):
        raise ValueError("語音回覆文字格式錯誤")
    if language not in {"zh-TW", "en-US"}:
        raise ValueError("不支援的語音回覆語言")
    return text, language


class EventStore:
    def __init__(self, port: str) -> None:
        self._lock = threading.Lock()
        self._next_id = 1
        self._events: list[dict[str, Any]] = []
        self.connected = False
        self.port = port
        self.blue: bool | None = None
        self.green: bool | None = None

    def log(self, message: str, kind: str = "info") -> None:
        now = datetime.now().strftime("%H:%M:%S")
        safe_message = str(message).replace("\r", " ").replace("\n", " ")
        safe_kind = kind if kind in {"info", "warning", "error", "success"} else "info"
        print(f"[{now}] [{safe_kind.upper():<7}] {safe_message}", flush=True)

        with self._lock:
            self._events.append(
                {
                    "id": self._next_id,
                    "time": now,
                    "kind": safe_kind,
                    "message": safe_message,
                }
            )
            self._next_id += 1
            self._events = self._events[-300:]

    def set_connected(self, connected: bool) -> None:
        with self._lock:
            self.connected = connected
            if not connected:
                self.blue = None
                self.green = None

    def set_led_state(self, blue: bool, green: bool) -> None:
        with self._lock:
            self.blue = blue
            self.green = green

    def snapshot(self, since: int = 0) -> dict[str, Any]:
        with self._lock:
            return {
                "connected": self.connected,
                "port": self.port,
                "blue": self.blue,
                "green": self.green,
                "events": [event.copy() for event in self._events if event["id"] > since],
                "lastEventId": self._next_id - 1,
            }


class SpeechFeedback:
    """Speak through the Windows SAPI voice installed on the computer."""

    def __init__(self, events: EventStore) -> None:
        self.events = events
        self._lock = threading.Lock()
        self.available = pythoncom is not None and win32com is not None

    def speak(self, text: str, language: str) -> None:
        if not self.available:
            raise RuntimeError("Windows 語音回覆元件不可用")

        target_language = "404" if language == "zh-TW" else "409"
        with self._lock:
            pythoncom.CoInitialize()
            try:
                voice = win32com.client.Dispatch("SAPI.SpVoice")
                for token in voice.GetVoices():
                    if target_language.lower() in str(token.GetAttribute("Language")).lower():
                        voice.Voice = token
                        break
                voice.Rate = -1 if language == "zh-TW" else 0
                voice.Volume = 100
                voice.Speak(text)
                self.events.log(f"語音回覆：{text}", "success")
            except Exception as error:
                self.events.log(f"語音回覆失敗：{error}", "error")
                raise RuntimeError("Windows 語音回覆失敗") from error
            finally:
                pythoncom.CoUninitialize()

class SerialController:
    def __init__(self, port: str, baud: int, events: EventStore) -> None:
        self.port = port
        self.baud = baud
        self.events = events
        self._serial: Any = None
        self._reader_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._command_lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._pending_command: str | None = None
        self._pending_ack: threading.Event | None = None

    @property
    def connected(self) -> bool:
        return bool(self._serial and self._serial.is_open)

    def connect(self) -> bool:
        self.disconnect(quiet=True)

        if serial is None:
            self.events.log("找不到 pyserial，請執行：python -m pip install -r requirements.txt", "error")
            return False

        try:
            self._serial = serial.Serial(
                port=self.port,
                baudrate=self.baud,
                timeout=0.2,
                write_timeout=2,
            )
        except serial.SerialException as error:
            self._serial = None
            self.events.set_connected(False)
            self.events.log(f"無法開啟 {self.port}：{error}", "error")
            self.events.log("請關閉 Arduino 序列監控與其他正在使用此 COM 埠的程式", "warning")
            return False

        self._stop.clear()
        self.events.set_connected(True)
        self.events.log(f"已連接 {self.port}，baud={self.baud}", "success")
        self._reader_thread = threading.Thread(target=self._read_loop, name="serial-reader", daemon=True)
        self._reader_thread.start()
        threading.Thread(target=self._request_initial_state, name="initial-status", daemon=True).start()
        return True

    def _request_initial_state(self) -> None:
        time.sleep(0.5)
        try:
            self.send("STATUS", timeout=3)
        except (ConnectionError, TimeoutError):
            self.events.log("尚未收到板卡狀態；請確認韌體已上傳並按一下 RESET", "warning")

    def disconnect(self, quiet: bool = False) -> None:
        self._stop.set()
        serial_port = self._serial
        self._serial = None
        reader_thread = self._reader_thread
        self._reader_thread = None

        if serial_port is not None:
            try:
                serial_port.close()
            except Exception:
                pass

        self.events.set_connected(False)
        with self._pending_lock:
            if self._pending_ack:
                self._pending_ack.set()
            self._pending_command = None
            self._pending_ack = None

        if reader_thread and reader_thread is not threading.current_thread():
            reader_thread.join(timeout=1)

        if not quiet and serial_port is not None:
            self.events.log(f"已中斷 {self.port}", "warning")

    def _read_loop(self) -> None:
        read_buffer = bytearray()

        while not self._stop.is_set():
            serial_port = self._serial
            if serial_port is None:
                return

            try:
                chunk = serial_port.read(serial_port.in_waiting or 1)
            except (serial.SerialException, OSError) as error:
                if not self._stop.is_set():
                    self.events.log(f"序列埠中斷：{error}", "error")
                    self.disconnect(quiet=True)
                return

            if not chunk:
                continue

            read_buffer.extend(chunk)
            while b"\n" in read_buffer:
                raw_line, _, remainder = read_buffer.partition(b"\n")
                read_buffer = bytearray(remainder)
                line = raw_line.decode("utf-8", errors="replace").strip()
                self._handle_board_line(line)

    def _handle_board_line(self, line: str) -> None:
        if not line:
            return

        if line.endswith("READY AMB82-MINI"):
            self.events.log("板卡回覆：READY AMB82-MINI", "success")
            return

        if line.startswith("ACK "):
            command = line[4:].strip()
            self.events.log(f"板卡確認：ACK {command}", "success")
            with self._pending_lock:
                if command == self._pending_command and self._pending_ack:
                    self._pending_ack.set()
            return

        state_match = STATE_PATTERN.match(line)
        if state_match:
            blue = state_match[1] == "1"
            green = state_match[2] == "1"
            self.events.set_led_state(blue, green)
            self.events.log(f"板卡狀態：藍燈={'亮' if blue else '滅'}，綠燈={'亮' if green else '滅'}")
            return

        if line.startswith("ERR "):
            self.events.log(f"板卡錯誤：{line[4:]}", "error")
            return

        self.events.log(f"板卡訊息：{line}")

    def send(self, command: str, timeout: float = 4) -> None:
        if command not in VALID_COMMANDS:
            raise ValueError("不允許的控制指令")

        with self._command_lock:
            serial_port = self._serial
            if serial_port is None or not serial_port.is_open:
                raise ConnectionError(f"{self.port} 尚未連接")

            ack_event = threading.Event()
            with self._pending_lock:
                self._pending_command = command
                self._pending_ack = ack_event

            try:
                serial_port.write(f"{command}\n".encode("ascii"))
                serial_port.flush()
                self.events.log(f"送出指令：{command}")
            except (serial.SerialException, serial.SerialTimeoutException, OSError) as error:
                self.events.log(f"傳送失敗：{error}", "error")
                self.disconnect(quiet=True)
                raise ConnectionError(str(error)) from error

            acknowledged = ack_event.wait(timeout)
            with self._pending_lock:
                self._pending_command = None
                self._pending_ack = None

            if not self.connected:
                raise ConnectionError(f"{self.port} 已中斷")
            if not acknowledged:
                self.events.log(f"等待 ACK 逾時：{command}", "error")
                raise TimeoutError(f"{timeout:g} 秒內未收到板卡 ACK")


class ControllerHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[SimpleHTTPRequestHandler],
        controller: SerialController,
        events: EventStore,
        speech: SpeechFeedback,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.controller = controller
        self.events = events
        self.speech = speech


class ControllerHandler(SimpleHTTPRequestHandler):
    server: ControllerHTTPServer

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Content-Length 錯誤") from error

        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("要求內容大小錯誤")

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("JSON 格式錯誤") from error

        if not isinstance(payload, dict):
            raise ValueError("JSON 必須是物件")
        return payload

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            try:
                since = int(parse_qs(parsed.query).get("since", ["0"])[0])
            except ValueError:
                since = 0
            self._send_json(200, self.server.events.snapshot(max(0, since)))
            return

        if parsed.path == "/":
            self.send_response(302)
            self.send_header("Location", "/web/")
            self.end_headers()
            return

        super().do_GET()

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
        except ValueError as error:
            self._send_json(400, {"ok": False, "error": str(error)})
            return

        if self.path == "/api/log":
            message = str(payload.get("message", ""))
            kind = str(payload.get("kind", "info"))
            if message:
                self.server.events.log(message, kind)
            self._send_json(200, {"ok": True})
            return

        if self.path == "/api/speak":
            try:
                text, language = validate_speech_request(payload)
                self.server.speech.speak(text, language)
            except ValueError as error:
                self._send_json(400, {"ok": False, "error": str(error)})
                return
            except RuntimeError as error:
                self._send_json(503, {"ok": False, "error": str(error)})
                return
            self._send_json(200, {"ok": True})
            return

        if self.path == "/api/reconnect":
            connected = self.server.controller.connect()
            status = 200 if connected else 503
            response = self.server.events.snapshot()
            response.update({"ok": connected})
            self._send_json(status, response)
            return

        if self.path == "/api/command":
            command = str(payload.get("command", ""))
            transcript = str(payload.get("transcript", "")).strip()
            if command not in VALID_COMMANDS - {"STATUS"}:
                self._send_json(400, {"ok": False, "error": "不允許的控制指令"})
                return
            if transcript:
                self.server.events.log(f"語音辨識：{transcript}")
            try:
                self.server.controller.send(command)
            except ValueError as error:
                self._send_json(400, {"ok": False, "error": str(error)})
                return
            except ConnectionError as error:
                self._send_json(503, {"ok": False, "error": str(error)})
                return
            except TimeoutError as error:
                self._send_json(504, {"ok": False, "error": str(error)})
                return

            response = self.server.events.snapshot()
            response.update({"ok": True, "command": command})
            self._send_json(200, response)
            return

        self._send_json(404, {"ok": False, "error": "找不到 API"})

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial-port", default="COM3", help="Ameba serial port (default: COM3)")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--web-port", type=int, default=8000)
    parser.add_argument("--no-serial", action="store_true", help="Serve the UI without opening a serial port")
    args = parser.parse_args()

    if serial is None and not args.no_serial:
        print("缺少 pyserial。請先執行：python -m pip install -r requirements.txt", file=sys.stderr)
        raise SystemExit(2)

    os.chdir(PROJECT_ROOT)
    events = EventStore(args.serial_port)
    controller = SerialController(args.serial_port, args.baud, events)
    speech = SpeechFeedback(events)
    server = ControllerHTTPServer(("127.0.0.1", args.web_port), ControllerHandler, controller, events, speech)

    print("=" * 68, flush=True)
    print(" Ameba Mini 語音 LED 系統 - Python 主控台", flush=True)
    print("=" * 68, flush=True)
    print(f"控制頁：http://localhost:{args.web_port}/web/", flush=True)
    print(f"序列埠：{args.serial_port} @ {args.baud} bps", flush=True)
    print("按 Ctrl+C 可停止程式。", flush=True)
    print("-" * 68, flush=True)

    events.log("Python 控制程式已啟動")
    if args.no_serial:
        events.log("測試模式：未開啟序列埠", "warning")
    else:
        controller.connect()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n收到停止指令。", flush=True)
    finally:
        controller.disconnect()
        server.server_close()
        print("Python 控制程式已結束。", flush=True)


if __name__ == "__main__":
    main()
