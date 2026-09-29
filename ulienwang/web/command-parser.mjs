const CONTROL_COMMANDS = new Map([
  ["左邊開燈", "LEFT_ON"],
  ["左邊關燈", "LEFT_OFF"],
  ["右邊開燈", "RIGHT_ON"],
  ["右邊關燈", "RIGHT_OFF"],
  ["全部開燈", "ALL_ON"],
  ["全部關燈", "ALL_OFF"],
  ["閃爍三次", "BLINK_3"],
  ["blueon", "LEFT_ON"],
  ["bluelighton", "LEFT_ON"],
  ["blueoff", "LEFT_OFF"],
  ["bluelightoff", "LEFT_OFF"],
  ["greenon", "RIGHT_ON"],
  ["greenlighton", "RIGHT_ON"],
  ["greenoff", "RIGHT_OFF"],
  ["greenlightoff", "RIGHT_OFF"],
  ["lightson", "ALL_ON"],
  ["lightsoff", "ALL_OFF"],
  ["blinkthree", "BLINK_3"],
  ["blinknow", "BLINK_3"],
  ["lefton", "LEFT_ON"],
  ["leftoff", "LEFT_OFF"],
  ["righton", "RIGHT_ON"],
  ["rightoff", "RIGHT_OFF"],
  ["leftlighton", "LEFT_ON"],
  ["turnonleftlight", "LEFT_ON"],
  ["leftlightoff", "LEFT_OFF"],
  ["turnoffleftlight", "LEFT_OFF"],
  ["rightlighton", "RIGHT_ON"],
  ["turnonrightlight", "RIGHT_ON"],
  ["rightlightoff", "RIGHT_OFF"],
  ["turnoffrightlight", "RIGHT_OFF"],
  ["alllightson", "ALL_ON"],
  ["turnonalllights", "ALL_ON"],
  ["alllightsoff", "ALL_OFF"],
  ["turnoffalllights", "ALL_OFF"],
  ["blinkthreetimes", "BLINK_3"],
]);

export function normalizeTranscript(transcript) {
  return transcript
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s，。！？、,.!?;；:："'「」『』]/g, "");
}

export function commandFromTranscript(transcript) {
  return CONTROL_COMMANDS.get(normalizeTranscript(transcript)) ?? null;
}
