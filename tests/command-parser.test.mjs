import test from "node:test";
import assert from "node:assert/strict";
import { commandFromTranscript, normalizeTranscript } from "../web/command-parser.mjs";
import { commandFromTranscript as webUICommandFromTranscript } from "../webUI/command-parser.mjs";

test("normalizes spaces, punctuation, case, and full-width characters", () => {
  assert.equal(normalizeTranscript(" 左邊，開燈！ "), "左邊開燈");
  assert.equal(normalizeTranscript("LEFT LIGHT ON"), "leftlighton");
  assert.equal(normalizeTranscript("ｌｅｆｔ light on"), "leftlighton");
  assert.equal(normalizeTranscript("left on"), "lefton");
});

test("maps required Chinese voice commands", () => {
  assert.equal(commandFromTranscript("左邊開燈"), "LEFT_ON");
  assert.equal(commandFromTranscript("右邊開燈"), "RIGHT_ON");
});

test("maps extra Chinese and English commands", () => {
  assert.equal(commandFromTranscript("左邊關燈"), "LEFT_OFF");
  assert.equal(commandFromTranscript("全部關燈"), "ALL_OFF");
  assert.equal(commandFromTranscript("閃爍三次"), "BLINK_3");
  assert.equal(commandFromTranscript("turn on right light"), "RIGHT_ON");
  assert.equal(commandFromTranscript("right on"), "RIGHT_ON");
});

test("maps short, easy English commands in both web versions", () => {
  const cases = new Map([
    ["Blue on", "LEFT_ON"],
    ["Blue off", "LEFT_OFF"],
    ["Green on", "RIGHT_ON"],
    ["Green off", "RIGHT_OFF"],
    ["Lights on", "ALL_ON"],
    ["Lights off", "ALL_OFF"],
    ["Blink now", "BLINK_3"],
  ]);

  for (const [phrase, command] of cases) {
    assert.equal(commandFromTranscript(phrase), command);
    assert.equal(webUICommandFromTranscript(phrase), command);
  }
});

test("rejects non-control and partial phrases", () => {
  assert.equal(commandFromTranscript("今天天氣很好"), null);
  assert.equal(commandFromTranscript("左邊"), null);
  assert.equal(commandFromTranscript("請幫我左邊開燈"), null);
  assert.equal(commandFromTranscript("左邊開燈再右邊開燈"), null);
  assert.equal(commandFromTranscript("blue"), null);
  assert.equal(commandFromTranscript("green"), null);
  assert.equal(commandFromTranscript("alone"), null);
});
