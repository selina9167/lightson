import { commandFromTranscript } from "./command-parser.mjs";

const connectButton = document.querySelector("#connect");
const listenButton = document.querySelector("#listen");
const connectionText = document.querySelector("#connection-text");
const recognitionText = document.querySelector("#recognition-text");
const executionText = document.querySelector("#execution-text");
const speechLanguage = document.querySelector("#speech-language");
const speechReplyToggle = document.querySelector("#speech-reply");
const voiceHint = document.querySelector("#voice-hint");
const blueLamp = document.querySelector("#blue-lamp");
const greenLamp = document.querySelector("#green-lamp");
const eventLog = document.querySelector("#event-log");

const savedLanguage = localStorage.getItem("amebaSpeechLanguage");
if (["zh-TW", "en-US"].includes(savedLanguage)) speechLanguage.value = savedLanguage;
speechReplyToggle.checked = localStorage.getItem("amebaSpeechReply") !== "false";

let speechRecognition = null;
let boardConnected = false;
let lastEventId = 0;
let polling = false;
let keepListening = false;
let recognitionActive = false;
let restartTimer = null;
let speakingFeedback = false;
let speechSequence = 0;

const COMMAND_FEEDBACK = {
  LEFT_ON: ["藍燈已開啟", "Blue light is on"],
  LEFT_OFF: ["藍燈已關閉", "Blue light is off"],
  RIGHT_ON: ["綠燈已開啟", "Green light is on"],
  RIGHT_OFF: ["綠燈已關閉", "Green light is off"],
  ALL_ON: ["全部燈已開啟", "All lights are on"],
  ALL_OFF: ["全部燈已關閉", "All lights are off"],
  BLINK_3: ["閃爍三次完成", "Blink complete"],
};

function timestamp() {
  return new Date().toLocaleTimeString("zh-TW", { hour12: false });
}

function finishSpeechFeedback(sequence) {
  if (sequence !== speechSequence) return;
  speakingFeedback = false;
  if (keepListening && boardConnected) {
    window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(startRecognitionSession, 250);
  }
}

function speakInBrowser(text, language) {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      reject(new Error("瀏覽器不支援語音合成"));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = language === "en-US" ? 0.92 : 1;
    utterance.onend = resolve;
    utterance.onerror = () => reject(new Error("瀏覽器語音合成失敗"));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

async function speakFeedback(chineseText, englishText) {
  if (!speechReplyToggle.checked) return;
  window.clearTimeout(restartTimer);
  restartTimer = null;
  speakingFeedback = true;
  const sequence = ++speechSequence;
  const english = speechLanguage.value === "en-US";
  const text = english ? englishText : chineseText;
  const language = english ? "en-US" : "zh-TW";
  try {
    if (recognitionActive) speechRecognition?.abort();
    await api("/api/speak", {
      method: "POST",
      body: JSON.stringify({ text, language }),
    });
  } catch (serverError) {
    try {
      await speakInBrowser(text, language);
    } catch {
      sendBrowserLog(`語音回覆失敗：${serverError.message}`, "error");
    }
  } finally {
    finishSpeechFeedback(sequence);
  }
}

function speakCommandFeedback(command) {
  const feedback = COMMAND_FEEDBACK[command];
  if (feedback) speakFeedback(feedback[0], feedback[1]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function sendBrowserLog(message, kind = "info") {
  void api("/api/log", {
    method: "POST",
    body: JSON.stringify({ message, kind }),
  }).catch(() => {
    // A server error is reflected by the connection polling status.
  });
}

function appendEvent(message, kind = "info", eventTime = timestamp()) {
  const item = document.createElement("li");
  item.className = kind;
  item.textContent = `${eventTime}　${message}`;
  eventLog.prepend(item);
}

function setConnection(connected, message) {
  boardConnected = connected;
  connectionText.textContent = message;
  connectionText.dataset.state = connected ? "ok" : "error";
  connectButton.textContent = connected ? "重新連接 AMB82-MINI" : "連接 AMB82-MINI";
  listenButton.disabled = !connected || !speechRecognition;
  if (!connected && keepListening) stopContinuousListening("板卡連線中斷，已停止語音辨識");
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.disabled = !connected;
  });
}

function updateListeningControls() {
  listenButton.textContent = keepListening ? "停止語音辨識" : "開始語音辨識";
  listenButton.classList.toggle("is-listening", keepListening);
  listenButton.setAttribute("aria-pressed", String(keepListening));
  listenButton.disabled = !boardConnected || !speechRecognition;
  speechLanguage.disabled = keepListening;
}

function startRecognitionSession() {
  if (!keepListening || recognitionActive || !boardConnected) return;
  speechRecognition.lang = speechLanguage.value;
  try {
    speechRecognition.start();
  } catch (error) {
    keepListening = false;
    updateListeningControls();
    sendBrowserLog(`無法開始辨識：${error.message}`, "error");
  }
}

function beginContinuousListening() {
  keepListening = true;
  updateListeningControls();
  recognitionText.textContent = "持續聆聽中…按停止才會結束";
  recognitionText.dataset.state = "pending";
  startRecognitionSession();
}

function stopContinuousListening(message = "語音辨識已停止") {
  keepListening = false;
  window.clearTimeout(restartTimer);
  restartTimer = null;
  speakingFeedback = false;
  speechSequence += 1;
  window.speechSynthesis?.cancel();
  try {
    speechRecognition?.abort();
  } catch {
    // The recognizer may already be idle.
  }
  updateListeningControls();
  recognitionText.textContent = message;
  recognitionText.dataset.state = "ok";
}

function setLamp(element, on) {
  element.classList.toggle("on", on === true);
  element.classList.toggle("unknown", on === null);
  element.querySelector("strong").textContent = on === null ? "未知" : on ? "亮" : "滅";
}

async function sendCommand(command, transcript = "") {
  if (!boardConnected) throw new Error("Python 尚未連接 AMB82-MINI");
  executionText.textContent = `已送出 ${command}，等待板卡確認…`;
  executionText.dataset.state = "pending";
  await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command, transcript }),
  });
  executionText.textContent = `板卡已確認：${command}`;
  executionText.dataset.state = "ok";
  speakCommandFeedback(command);
}

async function safelySend(command, transcript = "") {
  try {
    await sendCommand(command, transcript);
  } catch (error) {
    executionText.textContent = `通訊失敗：${error.message}`;
    executionText.dataset.state = "error";
    sendBrowserLog(`瀏覽器通訊失敗：${error.message}`, "error");
    speakFeedback("通訊失敗", "Connection failed");
  }
}

async function refreshStatus() {
  if (polling) return;
  polling = true;
  try {
    let status = await api(`/api/status?since=${lastEventId}`);
    if (status.lastEventId < lastEventId) {
      eventLog.replaceChildren();
      lastEventId = 0;
      status = await api("/api/status?since=0");
    }
    const boardHasReported = status.blue !== null && status.green !== null;
    const connectionMessage = status.connected
      ? boardHasReported
        ? `${status.port} 與 AMB82-MINI 已連線`
        : `${status.port} 已開啟，等待板卡回覆`
      : `${status.port} 尚未連接`;
    setConnection(status.connected, connectionMessage);
    if (status.connected && !boardHasReported) connectionText.dataset.state = "pending";
    setLamp(blueLamp, status.blue);
    setLamp(greenLamp, status.green);
    for (const event of status.events) {
      appendEvent(event.message, event.kind, event.time);
    }
    lastEventId = status.lastEventId;
  } catch (error) {
    setConnection(false, "Python 控制程式未啟動");
  } finally {
    polling = false;
  }
}

function configureSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    recognitionText.textContent = "此瀏覽器不支援語音辨識，可改用下方按鈕測試";
    recognitionText.dataset.state = "error";
    return;
  }

  speechRecognition = new Recognition();
  speechRecognition.lang = speechLanguage.value;
  speechRecognition.continuous = true;
  speechRecognition.interimResults = false;
  speechRecognition.maxAlternatives = 1;

  speechRecognition.onstart = () => {
    recognitionActive = true;
    updateListeningControls();
    recognitionText.textContent = "持續聆聽中…按停止才會結束";
    recognitionText.dataset.state = "pending";
  };

  speechRecognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (!event.results[index].isFinal) continue;
      const transcript = event.results[index][0].transcript.trim();
      const command = commandFromTranscript(transcript);
      recognitionText.textContent = `辨識結果：${transcript}（持續聆聽中）`;
      if (command) {
        recognitionText.dataset.state = "ok";
        void safelySend(command, transcript);
      } else {
        recognitionText.dataset.state = "error";
        executionText.textContent = "非控制指令，LED 狀態未變更";
        executionText.dataset.state = "error";
        sendBrowserLog(`語音辨識：${transcript}；非控制指令，未傳送資料`, "warning");
        speakFeedback("無法辨識控制指令", "Command not recognized");
      }
    }
  };

  speechRecognition.onerror = (event) => {
    if (event.error === "aborted" && (speakingFeedback || !keepListening)) return;
    const errorMessages = {
      network: "語音服務無法連線；請改用桌面版 Chrome 或 Edge，並確認網路正常",
      "not-allowed": "麥克風權限未開啟；請允許此網站使用麥克風",
      "service-not-allowed": "瀏覽器禁止使用語音辨識服務",
      "audio-capture": "找不到可用的麥克風",
      "no-speech": "沒有聽到語音，請靠近麥克風後再試一次",
    };
    const message = errorMessages[event.error] || `語音辨識失敗：${event.error}`;
    recognitionText.textContent = message;
    recognitionText.dataset.state = "error";
    sendBrowserLog(`${message}（錯誤代碼：${event.error}）`, "error");
    if (["network", "not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      keepListening = false;
      updateListeningControls();
    }
  };

  speechRecognition.onend = () => {
    recognitionActive = false;
    if (keepListening && boardConnected && !speakingFeedback) {
      restartTimer = window.setTimeout(startRecognitionSession, 300);
    } else {
      updateListeningControls();
    }
  };

  updateListeningControls();
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    connectionText.textContent = "Python 正在重新連接…";
    connectionText.dataset.state = "pending";
    await api("/api/reconnect", { method: "POST", body: "{}" });
    await refreshStatus();
  } catch (error) {
    setConnection(false, `連線失敗：${error.message}`);
  } finally {
    connectButton.disabled = false;
  }
});

listenButton.addEventListener("click", () => {
  if (keepListening) stopContinuousListening();
  else beginContinuousListening();
});

speechLanguage.addEventListener("change", () => {
  localStorage.setItem("amebaSpeechLanguage", speechLanguage.value);
  if (speechRecognition) speechRecognition.lang = speechLanguage.value;
  const english = speechLanguage.value === "en-US";
  recognitionText.textContent = english ? "English mode ready" : "中文模式已就緒";
  recognitionText.dataset.state = "ok";
  voiceHint.textContent = english
    ? "Press once to listen continuously; press Stop when finished"
    : "按一次持續聆聽，完成後再按停止";
});

speechReplyToggle.addEventListener("change", () => {
  localStorage.setItem("amebaSpeechReply", String(speechReplyToggle.checked));
  if (!speechReplyToggle.checked) {
    speakingFeedback = false;
    speechSequence += 1;
    window.speechSynthesis?.cancel();
    if (keepListening && boardConnected && !recognitionActive) {
      window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(startRecognitionSession, 250);
    }
  } else {
    speakFeedback("語音回覆已開啟", "Voice feedback enabled");
  }
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => void safelySend(button.dataset.command));
});

configureSpeechRecognition();
setConnection(false, "正在尋找 Python 控制程式…");
sendBrowserLog("控制頁已載入");
void refreshStatus();
setInterval(() => void refreshStatus(), 500);
