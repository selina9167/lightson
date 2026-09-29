import threading
import unittest

from voice_controller import EventStore, SerialController, validate_speech_request


class SerialControllerProtocolTests(unittest.TestCase):
    def setUp(self):
        self.events = EventStore("COM3")
        self.controller = SerialController("COM3", 115200, self.events)

    def test_state_reply_updates_board_state(self):
        self.controller._handle_board_line("STATE blue=1 green=0")
        snapshot = self.events.snapshot()
        self.assertIs(snapshot["blue"], True)
        self.assertIs(snapshot["green"], False)

    def test_matching_ack_releases_waiter(self):
        waiter = threading.Event()
        self.controller._pending_command = "LEFT_ON"
        self.controller._pending_ack = waiter
        self.controller._handle_board_line("ACK LEFT_ON")
        self.assertTrue(waiter.is_set())

    def test_unknown_command_is_rejected_before_serial_write(self):
        with self.assertRaisesRegex(ValueError, "不允許"):
            self.controller.send("UNSAFE_COMMAND")


class SpeechFeedbackValidationTests(unittest.TestCase):
    def test_accepts_supported_languages(self):
        self.assertEqual(
            validate_speech_request({"text": "藍燈已開啟", "language": "zh-TW"}),
            ("藍燈已開啟", "zh-TW"),
        )
        self.assertEqual(
            validate_speech_request({"text": "Blue light is on", "language": "en-US"}),
            ("Blue light is on", "en-US"),
        )

    def test_rejects_invalid_speech_payload(self):
        with self.assertRaises(ValueError):
            validate_speech_request({"text": "", "language": "zh-TW"})
        with self.assertRaises(ValueError):
            validate_speech_request({"text": "hello", "language": "fr-FR"})


if __name__ == "__main__":
    unittest.main()

