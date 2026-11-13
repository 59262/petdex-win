import { app, BrowserWindow, Tray, Menu, screen, nativeImage } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

// GPU flags for transparent frameless window on Windows
app.commandLine.appendSwitch('enable-transparent-visuals');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PETDEX_DIR = join(homedir(), ".petdex");
const RUNTIME_DIR = join(PETDEX_DIR, "runtime");
const ACTIVE_PATH = join(RUNTIME_DIR, "active.json");
const WINDOW_W = 176;
const WINDOW_H = 224;

let mainWindow = null;
let chatWindow = null;
let tray = null;
let sidecarProcess = null;
let chatHistory = [];
let activePetSlug = null;

const CONFIG_PATH = join(PETDEX_DIR, "config.json");
const CHATS_DIR = join(PETDEX_DIR, "chats");

// --- Pet discovery ---
function discoverPets() {
  const roots = [
    join(__dirname, "..", "assets", "pets"),
    join(homedir(), ".codex", "pets"),
    join(PETDEX_DIR, "pets"),
  ];
  const seen = new Map();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      for (const slug of readdirSync(root)) {
        const dir = join(root, slug);
        for (const ext of ["webp", "png"]) {
          const spritePath = join(dir, `spritesheet.${ext}`);
          if (existsSync(spritePath)) {
            let displayName = slug;
            const petJsonPath = join(dir, "pet.json");
            if (existsSync(petJsonPath)) {
              try {
                const pj = JSON.parse(readFileSync(petJsonPath, "utf8"));
                if (pj.displayName) displayName = pj.displayName;
              } catch {}
            }
            seen.set(slug, { slug, displayName, dir, spritePath, ext });
            break;
          }
        }
      }
    } catch {}
  }
  return [...seen.values()];
}

function getActivePet(pets) {
  if (pets.length === 0) return null;
  if (existsSync(ACTIVE_PATH)) {
    try {
      const { slug } = JSON.parse(readFileSync(ACTIVE_PATH, "utf8"));
      const found = pets.find((p) => p.slug === slug);
      if (found) return found;
    } catch {}
  }
  return pets[0];
}

function setActivePet(slug) {
  if (conversationMode) stopConversationMode();
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(ACTIVE_PATH, JSON.stringify({ slug }));
}

// --- Sidecar ---
function startSidecar() {
  const sidecarPath = join(__dirname, "sidecar", "server.js");
  sidecarProcess = spawn(process.execPath, [sidecarPath], {
    env: { ...process.env, PETDEX_PARENT_PID: String(process.pid) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  sidecarProcess.stdout.on("data", (d) => process.stdout.write(`[sidecar] ${d}`));
  sidecarProcess.stderr.on("data", (d) => process.stderr.write(`[sidecar] ${d}`));
  sidecarProcess.on("exit", (code) => {
    console.log(`[sidecar] exited with code ${code}`);
    sidecarProcess = null;
  });
  return sidecarProcess;
}

// --- Window ---
function createWindow(pet, icon) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.max(0, Math.round((width - WINDOW_W) / 2));
  const y = Math.max(0, Math.round((height - WINDOW_H) / 2));

  console.log(`Creating window: ${WINDOW_W}x${WINDOW_H} at (${x}, ${y})`);
  console.log(`Pet: ${pet.displayName}, sprite: ${pet.spritePath}`);

  mainWindow = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    x,
    y,
    icon,
    title: '',
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadPetHTML(pet);

  // Windows 11 workaround: re-apply transparent bg on blur to prevent white title bar
  if (process.platform === 'win32') {
    mainWindow.on('blur', () => mainWindow.setBackgroundColor('#00000000'));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

function loadPetHTML(pet) {
  const html = buildHTML(pet.displayName, pet.dir, pet.spritePath);
  const htmlPath = join(RUNTIME_DIR, 'pet.html');
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(htmlPath, html, 'utf8');
  mainWindow.loadFile(htmlPath);
}

function buildHTML(displayName, petDir, spritePath) {
  // Use file:// for sprite so large spritesheets work reliably
  const spriteUrl = `file:///${spritePath.replace(/\\/g, '/')}`;

  let audioTags = '';
  const soundFiles = { run: 'run.mp3', jump: 'jump.mp3', wave: 'wave.mp3', fail: 'fail.mp3' };
  for (const [name, filename] of Object.entries(soundFiles)) {
    const soundPath = join(petDir, filename);
    if (existsSync(soundPath)) {
      const soundBuf = readFileSync(soundPath);
      const soundUrl = `data:audio/mpeg;base64,${soundBuf.toString("base64")}`;
      audioTags += `<audio id="sound-${name}" src="${soundUrl}" preload="auto"></audio>\n`;
    }
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; width: 100%; height: 100%; font-family: -apple-system, system-ui, sans-serif; pointer-events: none; }
  body { -webkit-user-select: none; user-select: none; }
  .stage { position: fixed; left: 16px; top: 32px; pointer-events: none; }
  .pet {
    aspect-ratio: 192 / 208;
    width: 9rem;
    image-rendering: pixelated;
    background-image: url('${spriteUrl}');
    background-repeat: no-repeat;
    background-size: 800% 900%;
    background-position: 0% 0%;
    pointer-events: auto;
    cursor: grab;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
  }
  .pet.dragging { cursor: grabbing; }
  .talk-bubble-wrap {
    position: fixed;
    left: 52px;
    top: 8px;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.8);
    transition: opacity 200ms ease, transform 200ms ease;
    z-index: 10;
  }
  .talk-bubble-wrap.visible {
    opacity: 1;
    transform: scale(1);
  }
  .talk-bubble-inner {
    background: rgba(255, 255, 255, 0.92);
    border: 2px solid #7eb8da;
    border-radius: 12px 12px 12px 4px;
    padding: 5px 8px;
    max-width: 70px;
    color: #333;
    font-size: 8px;
    line-height: 1.35;
    text-align: center;
    word-break: break-word;
    box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    position: relative;
  }
  .talk-bubble-inner::after {
    content: '';
    position: absolute;
    bottom: 4px;
    left: -7px;
    width: 10px;
    height: 10px;
    background: rgba(255, 255, 255, 0.92);
    border-left: 2px solid #7eb8da;
    border-bottom: 2px solid #7eb8da;
    transform: rotate(45deg);
  }
  .talk-bubble-wrap.listening .talk-bubble-inner {
    border-color: #2ecc71;
    animation: conv-pulse 2s ease-in-out infinite;
  }
  .talk-bubble-wrap.listening .talk-bubble-inner::after {
    border-left-color: #2ecc71;
    border-bottom-color: #2ecc71;
  }
  @keyframes conv-pulse {
    0%, 100% { box-shadow: 0 2px 6px rgba(46,204,113,0.2); }
    50% { box-shadow: 0 2px 14px rgba(46,204,113,0.5); }
  }
</style>
</head>
<body>
<div class="talk-bubble-wrap" id="bubbleWrap"><div class="talk-bubble-inner" id="bubbleEl"></div></div>
<div class="stage"><div class="pet" id="pet" data-state="idle"></div></div>
${audioTags}
<script>
const COLS = 8, ROWS = 9;
let SPEED = ${currentSpeed};
let VOLUME = ${currentVolume};
const STATES = {
  idle:          { row: 0, frames: [{c:0,d:280},{c:1,d:110},{c:2,d:110},{c:3,d:140},{c:4,d:140},{c:5,d:320}], slow: 6 },
  "running-right": { row: 1, count: 8, dur: 120, last: 220 },
  "running-left":  { row: 2, count: 8, dur: 120, last: 220 },
  waving:        { row: 3, count: 4, dur: 140, last: 280 },
  jumping:       { row: 4, count: 5, dur: 140, last: 280 },
  failed:        { row: 5, count: 8, dur: 140, last: 240 },
  waiting:       { row: 6, count: 6, dur: 150, last: 260 },
  running:       { row: 7, count: 6, dur: 120, last: 220 },
  review:        { row: 8, count: 6, dur: 150, last: 280 },
};

function pos(c, r) { return (c/(COLS-1)*100)+'% '+(r/(ROWS-1)*100)+'%'; }

function buildFrames(def) {
  const M = 1 / (SPEED || 1);
  if (def.frames) return def.frames.map(f => ({ c: f.c, r: def.row, d: f.d * (def.slow || 1) * M }));
  const out = [];
  for (let i = 0; i < def.count; i++) {
    out.push({ c: i, r: def.row, d: (i === def.count - 1 ? def.last : def.dur) * M });
  }
  return out;
}

const pet = document.getElementById('pet');
const bubbleEl = document.getElementById('bubbleEl');
const bubbleWrap = document.getElementById('bubbleWrap');
let audioCtx = null;
let currentAudio = null;

function stopSound() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

function playSound(state) {
  try {
    stopSound();
    if (state === 'idle') return;
    const names = { 'running-right': 'run', 'running-left': 'run', 'running': 'run', 'jumping': 'jump', 'waving': 'wave', 'failed': 'fail' };
    const name = names[state];
    if (name) {
      const audio = document.getElementById('sound-' + name);
      if (audio) {
        audio.volume = VOLUME || 0.5;
        audio.loop = true;
        audio.currentTime = 0;
        audio.play().catch(() => {});
        currentAudio = audio;
        return;
      }
    }
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    switch (state) {
      case 'jumping':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.2);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now); osc.stop(now + 0.25);
        return;
      case 'waving':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(660, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
        return;
      case 'running-right': case 'running-left': case 'running':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now); osc.stop(now + 0.06);
        return;
      case 'failed':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(150, now + 0.4);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
        return;
      case 'waiting':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, now);
        osc.frequency.setValueAtTime(400, now + 0.08);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
        return;
      case 'review':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.linearRampToValueAtTime(500, now + 0.3);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now); osc.stop(now + 0.35);
        return;
    }
  } catch(e) {}
}

let stateTimer = null;
let loopTimer = null;
let loopAction = null;
let lastSoundState = null;
const LOOP_DELAY = 30000;

function play(state, loop) {
  clearTimeout(stateTimer);
  clearTimeout(loopTimer);
  if (state !== lastSoundState) {
    playSound(state);
    lastSoundState = state;
  }
  if (loop === true) loopAction = state;
  const def = STATES[state] || STATES.idle;
  const frames = buildFrames(def);
  let i = 0;
  pet.style.backgroundPosition = pos(frames[0].c, frames[0].r);
  pet.dataset.state = state;
  if (frames.length === 1) return;
  const tick = () => {
    stateTimer = setTimeout(() => {
      i++;
      if (i >= frames.length) {
        if (loop !== false || state === 'idle') {
          if (loopAction && state !== 'idle') {
            loopAction = null;
            play('idle', true);
            loopTimer = setTimeout(() => play(state, true), LOOP_DELAY);
            return;
          }
          i = 0;
        } else {
          play('idle', true);
          return;
        }
      }
      pet.style.backgroundPosition = pos(frames[i].c, frames[i].r);
      tick();
    }, frames[i].d);
  };
  tick();
}

play('idle', true);

// Random action every 60 seconds
const ACTION_STATES = ['running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];
setInterval(() => {
  if (dragging) return;
  const state = ACTION_STATES[Math.floor(Math.random() * ACTION_STATES.length)];
  play(state, true);
}, 60000);

const THRESHOLD = 4;
let dragging = false;
let lastDragX = 0;

pet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  lastDragX = e.screenX;
  pet.classList.add('dragging');
  play('jumping', false);
  pet.setPointerCapture(e.pointerId);
});

pet.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastDragX;
  lastDragX = e.screenX;
  window.electronAPI.moveWindow(e.movementX, e.movementY);
  if (dx >= THRESHOLD) play('running-right');
  else if (dx <= -THRESHOLD) play('running-left');
});

pet.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  pet.classList.remove('dragging');
  play('idle', true);
});

pet.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  const pets = await window.electronAPI.getPets();
  const activeSlug = await window.electronAPI.getActiveSlug();
  window.electronAPI.showContextMenu(pets, activeSlug);
});

pet.addEventListener('dblclick', () => {
  window.electronAPI.toggleChat();
});

let lastStateCounter = -1;
let lastBubbleCounter = -1;

async function pollState() {
  if (dragging) return;
  try {
    const data = await window.electronAPI.getState();
    if (data && data.counter !== lastStateCounter) {
      lastStateCounter = data.counter;
      play(data.state || 'idle');
    }
  } catch {}
}

let bubbleHideTimer = null;

async function pollBubble() {
  try {
    const data = await window.electronAPI.getBubble();
    if (data && data.counter !== lastBubbleCounter) {
      lastBubbleCounter = data.counter;
      if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
      if (data.text) {
        bubbleEl.textContent = data.text;
        bubbleWrap.classList.add('visible');
        bubbleWrap.classList.remove('listening');
        bubbleHideTimer = setTimeout(() => bubbleWrap.classList.remove('visible'), 8000);
      } else {
        bubbleWrap.classList.remove('visible');
      }
    }
  } catch {}
}

// --- Conversation mode audio capture ---
let convActive = false;
let convAudioCtx = null;
let convStream = null;
let convScriptNode = null;

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

window.electronAPI.onConvStart(async () => {
  if (convActive) return;
  try {
    convStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    convAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = convAudioCtx.createMediaStreamSource(convStream);
    convScriptNode = convAudioCtx.createScriptProcessor(2048, 1, 1);
    convScriptNode.onaudioprocess = (e) => {
      if (!convActive) return;
      const floatSamples = e.inputBuffer.getChannelData(0);
      const pcmBuf = new ArrayBuffer(floatSamples.length * 2);
      const pcmView = new DataView(pcmBuf);
      for (let i = 0; i < floatSamples.length; i++) {
        const s = Math.max(-1, Math.min(1, floatSamples[i]));
        pcmView.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      window.electronAPI.sendAudioChunk(arrayBufferToBase64(pcmBuf));
    };
    source.connect(convScriptNode);
    convScriptNode.connect(convAudioCtx.destination);
    convActive = true;
    // Show bubble indicator
    bubbleEl.textContent = '...';
    bubbleWrap.classList.add('visible', 'listening');
  } catch (err) {
    convActive = false;
  }
});

window.electronAPI.onConvStop(() => {
  convActive = false;
  if (convScriptNode) { convScriptNode.disconnect(); convScriptNode = null; }
  if (convStream) { convStream.getTracks().forEach(t => t.stop()); convStream = null; }
  if (convAudioCtx) { convAudioCtx.close(); convAudioCtx = null; }
  // Hide bubble
  if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
  bubbleWrap.classList.remove('visible', 'listening');
});

</script>
</body>
</html>`;
}

// --- Config ---
function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch {}
  return { llm: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" } };
}

function saveConfig(config) {
  mkdirSync(PETDEX_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// --- Chat History per pet ---
function chatHistoryPath(slug) {
  return join(CHATS_DIR, slug + ".json");
}

function loadChatHistory(slug) {
  if (!slug) return [];
  try {
    const path = chatHistoryPath(slug);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8"));
    }
  } catch {}
  return [];
}

function saveChatHistory(slug, history) {
  if (!slug || history.length === 0) return;
  mkdirSync(CHATS_DIR, { recursive: true });
  writeFileSync(chatHistoryPath(slug), JSON.stringify(history, null, 2), "utf8");
}

function switchChatHistory(slug) {
  if (activePetSlug !== slug) {
    // Save current history before switching to a different pet
    if (activePetSlug && chatHistory.length > 0) {
      saveChatHistory(activePetSlug, chatHistory);
    }
    activePetSlug = slug;
  }
  // Always reload from disk
  chatHistory = loadChatHistory(slug);
}

// --- Persona ---
function loadPersona(slug) {
  if (!slug) return null;
  const personaPath = join(PETDEX_DIR, "pets", slug, "persona.md");
  try {
    if (existsSync(personaPath)) {
      return readFileSync(personaPath, "utf8");
    }
  } catch {}
  return null;
}

// --- Chat Window ---
function getChatBounds() {
  if (!mainWindow) return { x: 100, y: 100 };
  const [px, py] = mainWindow.getPosition();
  return { x: px - 320 - 8, y: py, width: 320, height: 420 };
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return;
  }

  const bounds = getChatBounds();
  chatWindow = new BrowserWindow({
    ...bounds,
    title: '',
    transparent: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#141418',
    webPreferences: {
      preload: join(__dirname, "chat-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  chatWindow.loadFile(join(__dirname, "chat.html"));

  // Windows 11 workaround for chat window
  if (process.platform === 'win32') {
    chatWindow.on('blur', () => chatWindow.setBackgroundColor('#00000000'));
  }

  // Allow close but intercept to hide
  chatWindow.on("close", (e) => {
    e.preventDefault();
    chatWindow.hide();
  });
}

function toggleChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
    chatWindow.hide();
  } else {
    // Load current pet's chat history
    const pets = discoverPets();
    const active = getActivePet(pets);
    if (active) switchChatHistory(active.slug);

    createChatWindow();
    if (chatWindow) {
      const bounds = getChatBounds();
      chatWindow.setBounds(bounds);
      chatWindow.show();
      chatWindow.focus();
    }
  }
}

// --- LLM API call with SSE streaming ---
async function callLLM(messages) {
  const config = loadConfig();
  const { baseUrl, apiKey, model } = config.llm;

  if (!apiKey) {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send("chat-chunk", "\n\n[Error: Please set your API Key in the config bar above first.]");
      chatWindow.webContents.send("chat-done");
    }
    return;
  }

  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  console.log('[chat] calling API:', url, 'model:', model);

  // Build messages with persona if available
  const persona = loadPersona(activePetSlug);
  const apiMessages = persona
    ? [{ role: "system", content: persona }, ...messages]
    : messages;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        stream: true,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log('[chat] API response status:', res.status);

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error?.message || errMsg;
      } catch {}
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send("chat-chunk", `\n\n[Error: ${errMsg}]`);
        chatWindow.webContents.send("chat-done");
      }
      return;
    }

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = "";
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullResponse += content;
            if (chatWindow && !chatWindow.isDestroyed()) {
              chatWindow.webContents.send("chat-chunk", content);
            }
          }
        } catch {}
      }
    }
    // Add assistant response to history and persist
    chatHistory.push({ role: "assistant", content: fullResponse });
    if (activePetSlug) saveChatHistory(activePetSlug, chatHistory);
    return fullResponse;

  } catch (err) {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send("chat-chunk", `\n\n[Error: ${err.message}]`);
    }
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "user") {
      chatHistory.pop();
    }
    return "";
  } finally {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send("chat-done");
    }
  }
}

// --- Pet follow: reposition chat when pet moves ---
function updateChatPosition() {
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible() && mainWindow) {
    const bounds = getChatBounds();
    chatWindow.setBounds(bounds);
  }
}

// --- Tray ---
function createTray(icon) {
  tray = new Tray(icon || nativeImage.createEmpty());
  const contextMenu = Menu.buildFromTemplate([
    { label: "Show/Hide", click: () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); } },
    { type: "separator" },
    { label: "Quit", click: () => { app.quit(); } },
  ]);
  tray.setToolTip("Petdex Desktop Pet");
  tray.setContextMenu(contextMenu);
}

// --- Icon from spritesheet ---
function createAppIcon(spritePath) {
  try {
    const buf = readFileSync(spritePath);
    const img = nativeImage.createFromBuffer(buf);
    const size = img.getSize();
    const cellW = Math.floor(size.width / 8);
    const cellH = Math.floor(size.height / 9);
    const frame = img.crop({ x: 0, y: 0, width: cellW, height: cellH });
    const icon16 = frame.resize({ width: 16, height: 16 });
    const icon32 = frame.resize({ width: 32, height: 32 });
    return { tray: icon16, app: icon32 };
  } catch (e) {
    console.error("Failed to create icon:", e.message);
    return null;
  }
}

// --- App lifecycle ---
app.whenReady().then(() => {
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const pets = discoverPets();
  const active = getActivePet(pets);

  if (!active) {
    console.error("No pets found. Install a pet first.");
    app.quit();
    return;
  }

  activePetSlug = active.slug;
  chatHistory = loadChatHistory(active.slug);
  const icons = createAppIcon(active.spritePath);
  startSidecar();

  setTimeout(() => {
    createWindow(active, icons ? icons.app : null);
    createTray(icons ? icons.tray : null);
  }, 800);
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (activePetSlug && chatHistory.length > 0) saveChatHistory(activePetSlug, chatHistory);
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.destroy();
    chatWindow = null;
  }
  if (sidecarProcess) {
    sidecarProcess.kill();
    sidecarProcess = null;
  }
});

// --- IPC handlers ---
import { ipcMain } from "electron";

ipcMain.handle("get-pets", () => discoverPets());
ipcMain.handle("get-active-slug", () => {
  const pets = discoverPets();
  const active = getActivePet(pets);
  return active ? active.slug : null;
});
ipcMain.handle("set-active-pet", (_, slug) => {
  if (conversationMode) stopConversationMode();
  setActivePet(slug);
  switchChatHistory(slug);
  // Notify chat window to reload messages
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send("chat-reload-history");
  }
  const pets = discoverPets();
  const pet = pets.find((p) => p.slug === slug);
  if (pet && mainWindow) {
    const icons = createAppIcon(pet.spritePath);
    if (icons) {
      mainWindow.setIcon(icons.app);
      if (tray) tray.setImage(icons.tray);
    }
    loadPetHTML(pet);
  }
});
ipcMain.handle("move-window", (_, dx, dy) => {
  if (!mainWindow) return { hitX: false, hitY: false };
  const [wx, wy] = mainWindow.getPosition();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  let nx = wx + dx, ny = wy + dy;
  let hitX = false, hitY = false;
  if (nx < 0) { nx = 0; hitX = true; }
  if (ny < 0) { ny = 0; hitY = true; }
  if (nx > width - WINDOW_W) { nx = width - WINDOW_W; hitX = true; }
  if (ny > height - WINDOW_H) { ny = height - WINDOW_H; hitY = true; }
  mainWindow.setPosition(Math.round(nx), Math.round(ny));
  updateChatPosition();
  return { hitX, hitY };
});
let currentSpeed = 2;
let currentVolume = 0.5;
let conversationMode = false;
let convWS = null;
let convSampleRate = 48000;
let convSentenceQueue = [];
let convProcessing = false;
let convMuteUntil = 0;

ipcMain.handle("show-context-menu", (_, pets, activeSlug) => {
  // 皮肤 submenu
  const skinItems = pets.map((p) => ({
    label: p.displayName,
    type: "radio",
    checked: p.slug === activeSlug,
    click: () => {
      setActivePet(p.slug);
      switchChatHistory(p.slug);
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send("chat-reload-history");
      }
      if (mainWindow) {
        const icons = createAppIcon(p.spritePath);
        if (icons) {
          mainWindow.setIcon(icons.app);
          if (tray) tray.setImage(icons.tray);
        }
        loadPetHTML(p);
      }
    },
  }));
  const items = [];
  items.push({ label: "皮肤", submenu: skinItems });
  items.push({ type: "separator" });
  items.push({
    label: "对话模式",
    type: "checkbox",
    checked: conversationMode,
    click: () => {
      if (conversationMode) {
        stopConversationMode();
      } else {
        startConversationMode();
      }
    },
  });
  items.push({ label: "对话框", click: () => toggleChatWindow() });
  items.push({ type: "separator" });
  const states = [
    { label: "待机", state: "idle" },
    { label: "奔跑", state: "running" },
    { label: "挥手", state: "waving" },
    { label: "跳跃", state: "jumping" },
    { label: "失败", state: "failed" },
    { label: "等待", state: "waiting" },
    { label: "检查", state: "review" },
  ];
  items.push({
    label: "动作",
    submenu: states.map((s) => ({
      label: s.label,
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.executeJavaScript(`play('${s.state}', true)`);
        }
      },
    })),
  });
  const speeds = [
    { label: "0.5x", value: 0.5 },
    { label: "1x", value: 1 },
    { label: "1.5x", value: 1.5 },
    { label: "2x", value: 2 },
    { label: "3x", value: 3 },
    { label: "5x", value: 5 },
  ];
  items.push({
    label: "速度",
    submenu: speeds.map((s) => ({
      label: s.label,
      type: "radio",
      checked: s.value === currentSpeed,
      click: () => {
        currentSpeed = s.value;
        if (mainWindow) {
          mainWindow.webContents.executeJavaScript(`
            SPEED = ${s.value};
            clearTimeout(stateTimer);
            play('waving', false);
          `);
        }
      },
    })),
  });
  items.push({ type: "separator" });
  const volumes = [
    { label: "10%", value: 0.1 },
    { label: "25%", value: 0.25 },
    { label: "50%", value: 0.5 },
    { label: "75%", value: 0.75 },
    { label: "100%", value: 1 },
  ];
  items.push({
    label: "音量",
    submenu: volumes.map((v) => ({
      label: v.label,
      type: "radio",
      checked: v.value === currentVolume,
      click: () => {
        currentVolume = v.value;
        if (mainWindow) {
          mainWindow.webContents.executeJavaScript(`
            VOLUME = ${v.value};
            if (currentAudio) currentAudio.volume = ${v.value};
          `);
        }
        if (chatWindow && !chatWindow.isDestroyed()) {
          chatWindow.webContents.send("chat-volume", v.value);
        }
      },
    })),
  });
  items.push({ type: "separator" });
  items.push({ label: "退出", click: () => app.quit() });
  const menu = Menu.buildFromTemplate(items);
  menu.popup({ window: mainWindow });
});

// --- Conversation Mode ---
function getSidecarToken() {
  try {
    const tokenPath = join(RUNTIME_DIR, "update-token");
    if (existsSync(tokenPath)) return readFileSync(tokenPath, "utf8").trim();
  } catch {}
  return null;
}

function startConversationMode() {
  if (conversationMode) return;
  conversationMode = true;
  console.log("[conv] Starting conversation mode");

  // Auto-open chat window
  if (!chatWindow || chatWindow.isDestroyed() || !chatWindow.isVisible()) {
    toggleChatWindow();
  }

  // Tell pet window to start recording
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet-conv-start");
  }

  // Open persistent Fun-ASR WebSocket
  const speechConfig = loadSpeechConfig();
  const apiKey = speechConfig.apiKey;
  const TASK_ID = randomUUID();

  convWS = new WebSocket("wss://dashscope.aliyuncs.com/api-ws/v1/inference", {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });

  let taskStarted = false;

  convWS.on("open", () => {
    console.log("[conv] WS connected, task:", TASK_ID);
    convWS.send(JSON.stringify({
      header: { action: "run-task", task_id: TASK_ID, streaming: "duplex" },
      payload: {
        task_group: "audio",
        task: "asr",
        function: "recognition",
        model: "fun-asr-realtime",
        parameters: {
          format: "pcm",
          sample_rate: convSampleRate,
          language_hints: ["zh"],
          max_sentence_silence: 1500,
        },
        input: {},
      },
    }));
  });

  convWS.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const header = msg.header || {};
      const payload = msg.payload || {};

      if (header.event === "task-started") {
        taskStarted = true;
        console.log("[conv] task-started");
      }

      if (header.event === "result-generated") {
        const output = payload.output;
        if (output) {
          const sentence = output.sentence;
          if (sentence && sentence.text && sentence.sentence_end) {
            console.log("[conv] sentence:", sentence.text);
            handleConvSentence(sentence.text);
          }
        }
      }

      if (header.event === "task-failed") {
        console.error("[conv] task-failed:", JSON.stringify(payload).slice(0, 200));
      }
    } catch {}
  });

  convWS.on("error", (err) => {
    console.error("[conv] WS error:", err.message);
    stopConversationMode();
  });

  convWS.on("close", (code) => {
    console.log("[conv] WS closed, code:", code);
    if (conversationMode) stopConversationMode();
  });
}

function stopConversationMode() {
  if (!conversationMode) return;
  conversationMode = false;
  console.log("[conv] Stopping conversation mode");

  if (convWS) {
    try {
      if (convWS.readyState === WebSocket.OPEN) {
        convWS.send(JSON.stringify({
          header: { action: "finish-task", task_id: randomUUID() },
          payload: {},
        }));
        convWS.close();
      }
    } catch {}
    convWS = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet-conv-stop");
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send("chat-conv-stop");
  }

  convSentenceQueue = [];
  convProcessing = false;
}

async function handleConvSentence(text) {
  if (!text || !text.trim()) return;

  // Show "thinking" bubble immediately
  const token = getSidecarToken();
  if (token) {
    try {
      await fetch("http://127.0.0.1:7777/bubble", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-petdex-update-token": token },
        body: JSON.stringify({ text: "..." }),
      });
    } catch {}
  }

  // Show recognized text in chat window
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send("chat-conv-sentence", text.trim());
  }

  // Queue for processing (prevent overlapping)
  convSentenceQueue.push(text.trim());
  processConvQueue();
}

async function processConvQueue() {
  if (convProcessing || convSentenceQueue.length === 0) return;
  convProcessing = true;

  while (convSentenceQueue.length > 0) {
    const text = convSentenceQueue.shift();
    try {
      chatHistory.push({ role: "user", content: text });
      const fullResponse = await callLLM(chatHistory);

      if (fullResponse) {
        try {
          const audioBase64 = await dashScopeTTS(fullResponse);
          if (audioBase64 && chatWindow && !chatWindow.isDestroyed()) {
            convMuteUntil = Date.now() + 4000; // mute mic during TTS playback
            chatWindow.webContents.send("chat-audio", audioBase64);
          }
        } catch (err) { console.error("[conv] TTS error:", err.message); }

        const token = getSidecarToken();
        if (token) {
          try {
            await fetch("http://127.0.0.1:7777/bubble", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-petdex-update-token": token,
              },
              body: JSON.stringify({ text: fullResponse.replace(/[（(][^)）]*[)）]/g, '').replace(/\n+/g, ' ').trim().slice(0, 120) }),
            });
          } catch {}
        }
      }
    } catch (err) { console.error("[conv] LLM error:", err.message); }
  }

  convProcessing = false;
}

let convChunkCount = 0;
// IPC: receive PCM chunks from renderer
ipcMain.on("conv-audio-chunk", (_, base64) => {
  if (!conversationMode || !convWS || convWS.readyState !== WebSocket.OPEN) return;
  if (Date.now() < convMuteUntil) return; // mute during TTS playback
  try {
    const pcm = Buffer.from(base64, "base64");
    convWS.send(pcm);
    convChunkCount++;
    if (convChunkCount % 50 === 0) console.log("[conv] sent", convChunkCount, "audio chunks");
  } catch {}
});

// IPC: interrupt TTS/mute
ipcMain.on("conv-interrupt", () => {
  convMuteUntil = 0;
});

// --- Chat IPC handlers ---
ipcMain.handle("toggle-chat", () => {
  toggleChatWindow();
});

ipcMain.handle("chat-send", async (_, text, voiceMode) => {
  chatHistory.push({ role: "user", content: text });
  const fullResponse = await callLLM(chatHistory);

});

ipcMain.handle("chat-get-history", () => chatHistory);

ipcMain.handle("chat-get-pet-name", () => {
  const pets = discoverPets();
  const active = getActivePet(pets);
  return active ? active.displayName : "Pet";
});

ipcMain.handle("chat-get-config", () => loadConfig().llm);

ipcMain.handle("chat-save-config", (_, llmConfig) => {
  const config = loadConfig();
  config.llm = { ...config.llm, ...llmConfig };
  saveConfig(config);
  return true;
});

ipcMain.handle("chat-get-speech-config", () => loadConfig().speech || { provider: "dashscope", apiKey: "", ttsVoice: "longxiaochun_v2", ttsRate: 1.0 });

ipcMain.handle("chat-save-speech-config", (_, speechConfig) => {
  const config = loadConfig();
  config.speech = { ...config.speech, ...speechConfig };
  saveConfig(config);
  return true;
});

ipcMain.on("chat-hide", () => {
  if (activePetSlug && chatHistory.length > 0) saveChatHistory(activePetSlug, chatHistory);
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.hide();
  }
});

ipcMain.on("chat-clear", () => {
  chatHistory = [];
});

// --- Sidecar HTTP helpers for renderer ---
ipcMain.handle("get-state", async () => {
  try {
    const res = await fetch("http://127.0.0.1:7777/state");
    return await res.json();
  } catch {
    return { state: "idle", counter: -1 };
  }
});
ipcMain.handle("get-bubble", async () => {
  try {
    const res = await fetch("http://127.0.0.1:7777/bubble");
    return await res.json();
  } catch {
    return { text: "", counter: -1 };
  }
});

// --- DashScope ASR ---
function loadSpeechConfig() {
  const config = loadConfig();
  return config.speech || { provider: "dashscope", apiKey: "" };
}

async function dashScopeASR(audioBuffer, sampleRate) {
  const speechConfig = loadSpeechConfig();
  const apiKey = speechConfig.apiKey;
  if (!apiKey) throw new Error("未配置语音识别 API Key");

  const TASK_ID = randomUUID();
  console.log("[speech] Starting ASR, size:", audioBuffer.length, "bytes, rate:", sampleRate, "task:", TASK_ID);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://dashscope.aliyuncs.com/api-ws/v1/inference", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });

    let transcription = "";
    let taskStarted = false;
    let finished = false;
    let timer = null;

    const done = (text, err) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      console.log("[speech] Done - text:", text, "err:", err?.message);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try { ws.close(); } catch {}
      }
      if (err) reject(err);
      else resolve(text || transcription);
    };

    timer = setTimeout(() => done("", new Error("语音识别超时")), 30000);

    ws.on("open", () => {
      console.log("[speech] WebSocket connected, sending run-task");
      ws.send(JSON.stringify({
        header: {
          action: "run-task",
          task_id: TASK_ID,
          streaming: "duplex",
        },
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model: "fun-asr-realtime",
          parameters: {
            format: "pcm",
            sample_rate: sampleRate,
            language_hints: ["zh"],
            semantic_punctuation_enabled: true,
            max_sentence_silence: 1500,
          },
          input: {},
        },
      }));
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const header = msg.header || {};
        const payload = msg.payload || {};
        console.log("[speech] WS event:", header.event);

        if (header.event === "task-started") {
          taskStarted = true;
          console.log("[speech] task-started, streaming audio chunks");
          const CHUNK = 9600; // ~100ms of 48kHz 16-bit mono
          let offset = 0;
          const sendChunk = () => {
            if (offset >= audioBuffer.length) {
              console.log("[speech] All chunks sent, finish-task");
              ws.send(JSON.stringify({
                header: { action: "finish-task", task_id: TASK_ID },
                payload: {},
              }));
              return;
            }
            const end = Math.min(offset + CHUNK, audioBuffer.length);
            ws.send(audioBuffer.subarray(offset, end));
            offset = end;
            setTimeout(sendChunk, 30);
          };
          sendChunk();
        }

        if (header.event === "task-finished") {
          transcription = payload.output?.text || transcription;
          console.log("[speech] task-finished, text:", transcription);
          done(transcription);
        }

        if (header.event === "result-generated") {
          const output = payload.output;
          if (output) {
            const text = typeof output.text === 'string' ? output.text
              : (output.sentence && typeof output.sentence.text === 'string' ? output.sentence.text
              : (typeof output.result === 'string' ? output.result : ''));
            if (text) {
              transcription = text;
            }
          }
        }

        if (header.event === "task-failed") {
          console.log("[speech] task-failed:", JSON.stringify(payload).slice(0, 200));
          // Use accumulated transcription from result-generated events
          if (transcription) {
            done(transcription);
          } else {
            done("", new Error("语音识别失败"));
          }
        }
      } catch {}
    });

    ws.on("error", (err) => {
      console.error("[speech] WS error:", err.message);
      done("", new Error(err.message || "连接失败"));
    });

    ws.on("close", (code, reason) => {
      console.log("[speech] WS closed, code:", code, "reason:", reason?.toString());
      if (!taskStarted) {
        done("", new Error("服务未响应"));
      }
    });
  });
}

function loadPetTTSConfig() {
  try {
    const petJsonPath = join(PETDEX_DIR, "pets", activePetSlug, "pet.json");
    if (existsSync(petJsonPath)) {
      const petCfg = JSON.parse(readFileSync(petJsonPath, "utf8"));
      if (petCfg.tts) return petCfg.tts;
    }
  } catch {}
  return null;
}

async function dashScopeTTS(text) {
  const speechConfig = loadSpeechConfig();
  const apiKey = speechConfig.apiKey;
  if (!apiKey) throw new Error("未配置语音识别 API Key");

  // Pet-specific voice overrides global config
  const petTTS = loadPetTTSConfig();
  const model = petTTS?.model || "cosyvoice-v2";
  const voice = petTTS?.voice || speechConfig.ttsVoice || "longxiaochun_v2";
  const rate = petTTS?.rate ?? speechConfig.ttsRate ?? 1.0;
  const sampleRate = model.includes("v3.5") ? 24000 : 22050;

  // Strip parenthetical action descriptions like （怔了一下）and keep only spoken text
  const cleanText = text
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/\n{3,}/g, '\n')
    .trim();
  if (!cleanText) return null;
  console.log("[speech] TTS request, text:", cleanText.slice(0, 80), "voice:", voice, "model:", model, "rate:", rate);

  const res = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      input: {
        text: cleanText,
        voice: voice,
        format: "wav",
        sample_rate: sampleRate,
        rate: rate,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[speech] TTS error:", res.status, errText.slice(0, 200));
    throw new Error(`TTS failed: HTTP ${res.status}`);
  }

  // Response may be JSON with OSS URL, or raw audio
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await res.json();
    console.log("[speech] TTS JSON response keys:", Object.keys(json.output?.audio || {}));
    const audioUrl = json.output?.audio?.url;
    if (!audioUrl) throw new Error("TTS response has no audio URL");
    console.log("[speech] TTS downloading audio from:", audioUrl.slice(0, 80));
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Audio download failed: HTTP ${audioRes.status}`);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    console.log("[speech] TTS audio downloaded, size:", audioBuffer.length);
    return audioBuffer.toString("base64");
  }
  // Raw audio (WAV)
  const audioBuffer = Buffer.from(await res.arrayBuffer());
  console.log("[speech] TTS raw audio, size:", audioBuffer.length);
  return audioBuffer.toString("base64");
}

ipcMain.handle("chat-speech-to-text", async (_, audioData, sampleRate) => {
  if (!audioData) return "";
  try {
    const audioBuffer = Buffer.from(audioData);
    if (audioBuffer.length < 1000) return "";
    console.log("[speech] Received PCM, size:", audioBuffer.length, "rate:", sampleRate);
    const text = await dashScopeASR(audioBuffer, sampleRate || 48000);
    return text;
  } catch (err) {
    console.error("[speech] ASR error:", err.message);
    throw err;
  }
});

