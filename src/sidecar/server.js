import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PETDEX_PORT ?? 7777);
const RUNTIME_DIR = join(homedir(), ".petdex", "runtime");
const STATE_PATH = join(RUNTIME_DIR, "state.json");
const BUBBLE_PATH = join(RUNTIME_DIR, "bubble.json");
const TOKEN_PATH = join(RUNTIME_DIR, "update-token");
const HOOKS_DISABLED_PATH = join(RUNTIME_DIR, "hooks-disabled");
const MAX_BODY = 64 * 1024;

// Ensure runtime directory exists
mkdirSync(RUNTIME_DIR, { recursive: true });

// Generate CSRF token for this session
const sessionToken = randomBytes(32).toString("hex");

function writeToken() {
  writeFileSync(TOKEN_PATH, sessionToken, { mode: 0o600 });
}

// --- Rate Limiter (token bucket) ---
class TokenBucket {
  constructor(rate = 30, burst = 60) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.lastRefill = Date.now();
  }
  consume() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

const rateLimiter = new TokenBucket();

// --- State Queue ---
class StateQueue {
  constructor(minDwellMs = 250) {
    this.minDwellMs = minDwellMs;
    this.queue = [];
    this.displayed = null;
    this.displayedAt = 0;
    this.counter = 0;
  }

  enqueue(state, duration, agentSource) {
    // Coalesce: drop if same as currently displayed (within dwell) or queue tail
    if (this.displayed && this.displayed.state === state && Date.now() - this.displayedAt < this.minDwellMs) {
      return;
    }
    if (this.queue.length > 0 && this.queue[this.queue.length - 1].state === state) {
      return;
    }
    // Bounded queue
    if (this.queue.length >= 50) {
      this.queue.shift();
    }
    this.queue.push({ state, duration, agentSource, enqueuedAt: Date.now() });
  }

  tick() {
    const now = Date.now();
    if (this.displayed) {
      const dwell = this.getStateDwell(this.displayed);
      if (now - this.displayedAt < dwell) return null;
    }
    const next = this.queue.shift();
    if (!next) return null;
    this.displayed = next;
    this.displayedAt = now;
    this.counter++;
    return next;
  }

  getStateDwell(entry) {
    const transientStates = ["waving", "failed", "review", "jumping"];
    if (transientStates.includes(entry.state) && entry.duration) {
      return Math.max(entry.duration, this.minDwellMs);
    }
    return this.minDwellMs;
  }

  getCurrent() {
    return this.displayed ? this.displayed.state : "idle";
  }
}

const stateQueue = new StateQueue();

// --- Running variant alternator ---
let lastRunningVariant = "running-left";

function nextRunningVariant() {
  lastRunningVariant = lastRunningVariant === "running-left" ? "running-right" : "running-left";
  return lastRunningVariant;
}

// --- State file I/O ---
function readState() {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, "utf8"));
    }
  } catch {}
  return { state: "idle", duration: null, updatedAt: Date.now(), counter: 0 };
}

function writeState(state, duration, agentSource) {
  const data = {
    state,
    duration,
    updatedAt: Date.now(),
    counter: stateQueue.counter,
    agent_source: agentSource || null,
  };
  writeFileSync(STATE_PATH, JSON.stringify(data));
}

function readBubble() {
  try {
    if (existsSync(BUBBLE_PATH)) {
      return JSON.parse(readFileSync(BUBBLE_PATH, "utf8"));
    }
  } catch {}
  return { text: "", agent_source: null, updatedAt: 0, counter: 0 };
}

let bubbleCounter = 0;
function writeBubble(text, agentSource) {
  bubbleCounter++;
  const data = {
    text: String(text).slice(0, 200),
    agent_source: agentSource || null,
    updatedAt: Date.now(),
    counter: bubbleCounter,
  };
  writeFileSync(BUBBLE_PATH, JSON.stringify(data));
}

// --- Token verification ---
function verifyToken(req) {
  const token = req.headers["x-petdex-update-token"];
  if (!token || typeof token !== "string") return false;
  try {
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(sessionToken, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// --- Body parser ---
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

// --- Valid states ---
const VALID_STATES = new Set([
  "idle", "running", "running-left", "running-right",
  "waving", "jumping", "failed", "review", "waiting",
]);

// --- Queue tick loop ---
setInterval(() => {
  const entry = stateQueue.tick();
  if (entry) {
    let state = entry.state;
    if (state === "running") {
      state = nextRunningVariant();
    }
    writeState(state, entry.duration, entry.agentSource);
  }
}, 100);

// --- HTTP Server ---
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "x-petdex-update-token, Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /health
  if (url.pathname === "/health" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }

  // GET /whoami
  if (url.pathname === "/whoami" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid, parentPid: process.ppid }));
    return;
  }

  // GET /state
  if (url.pathname === "/state" && method === "GET") {
    const data = readState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  // POST /state
  if (url.pathname === "/state" && method === "POST") {
    if (!verifyToken(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (!rateLimiter.consume()) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate limited" }));
      return;
    }
    try {
      const body = await parseBody(req);
      const state = body.state;
      if (!VALID_STATES.has(state)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid state" }));
        return;
      }
      const duration = Math.min(Number(body.duration) || 0, 30000);
      const agentSource = String(body.agent_source || "").slice(0, 64);

      stateQueue.enqueue(state, duration || null, agentSource);

      // If queue is small, immediately process
      let immediateState = state;
      if (immediateState === "running") {
        immediateState = nextRunningVariant();
      }
      writeState(immediateState, duration || null, agentSource);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /bubble
  if (url.pathname === "/bubble" && method === "GET") {
    const data = readBubble();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  // POST /bubble
  if (url.pathname === "/bubble" && method === "POST") {
    if (!verifyToken(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (!rateLimiter.consume()) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate limited" }));
      return;
    }
    try {
      const body = await parseBody(req);
      const text = String(body.text || "").slice(0, 200);
      const agentSource = String(body.agent_source || "").slice(0, 64);
      writeBubble(text, agentSource);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /init-status
  if (url.pathname === "/init-status" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ needsInit: false, checkedAt: Date.now() }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

// --- Startup ---
server.listen(PORT, "127.0.0.1", () => {
  writeToken();
  console.log(`[sidecar] listening on http://127.0.0.1:${PORT}`);
  console.log(`[sidecar] token: ${sessionToken.slice(0, 8)}...`);
});

// --- Parent watchdog ---
const parentPid = process.env.PETDEX_PARENT_PID;
if (parentPid) {
  setInterval(() => {
    try {
      process.kill(Number(parentPid), 0);
    } catch {
      console.log("[sidecar] parent exited, shutting down");
      process.exit(0);
    }
  }, 2000);
}

// --- Graceful shutdown ---
function shutdown() {
  console.log("[sidecar] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { PORT, sessionToken };
