#!/usr/bin/env node

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PETDEX_DIR = join(homedir(), ".petdex");
const RUNTIME_DIR = join(PETDEX_DIR, "runtime");
const PID_PATH = join(RUNTIME_DIR, "petdex-win.pid");
const TOKEN_PATH = join(RUNTIME_DIR, "update-token");

const args = process.argv.slice(2);
const command = args[0];

function getToken() {
  if (!existsSync(TOKEN_PATH)) return null;
  return readFileSync(TOKEN_PATH, "utf8").trim();
}

async function checkHealth() {
  try {
    const res = await fetch("http://127.0.0.1:7777/health", { signal: AbortSignal.timeout(2000) });
    return await res.json();
  } catch {
    return null;
  }
}

async function postState(state) {
  const token = getToken();
  if (!token) {
    console.log("Sidecar not running (no token). Start with: petdex-win up");
    return;
  }
  try {
    await fetch("http://127.0.0.1:7777/state", {
      method: "POST",
      headers: { "x-petdex-update-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ state, agent_source: "cli" }),
    });
    console.log(`State set to: ${state}`);
  } catch {
    console.log("Failed to reach sidecar. Is it running?");
  }
}

async function cmdUp() {
  console.log("Starting petdex-win desktop pet...");

  // Check if already running
  const health = await checkHealth();
  if (health && health.ok) {
    console.log("Already running on port 7777");
    return;
  }

  // Start Electron app
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const appPath = join(__dirname, "..", "src", "main.js");

  // Find electron executable
  const electronModulePath = join(__dirname, "..", "node_modules", "electron");
  const electronExePath = join(electronModulePath, "dist", "electron.exe");

  if (!existsSync(electronExePath)) {
    console.error("Electron not found. Run: npm install");
    process.exit(1);
  }

  // Launch Electron directly
  const child = spawn(electronExePath, [appPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(PID_PATH, JSON.stringify({ pid: child.pid, started: new Date().toISOString() }));

  console.log(`Petdex-win started (pid: ${child.pid})`);
}

async function cmdDown() {
  const health = await checkHealth();
  if (!health || !health.ok) {
    console.log("Not running");
    return;
  }

  // Try to read PID and kill
  if (existsSync(PID_PATH)) {
    try {
      const { pid } = JSON.parse(readFileSync(PID_PATH, "utf8"));
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Stopped process ${pid}`);
      } catch {
        console.log(`Process ${pid} already exited`);
      }
    } catch {}
  }

  console.log("Petdex-win stopped");
}

async function cmdToggle() {
  const health = await checkHealth();
  if (health && health.ok) {
    await cmdDown();
  } else {
    await cmdUp();
  }
}

async function cmdStatus() {
  const health = await checkHealth();
  if (health && health.ok) {
    console.log("Running on port 7777");
    try {
      const res = await fetch("http://127.0.0.1:7777/state");
      const data = await res.json();
      console.log(`Current state: ${data.state}`);
    } catch {}
  } else {
    console.log("Not running");
  }
}

async function cmdHooks() {
  const sub = args[1];
  if (sub === "install") {
    const { installHooks } = await import("../src/hooks/install.js");
    installHooks();
  } else if (sub === "uninstall") {
    const { uninstallHooks } = await import("../src/hooks/install.js");
    uninstallHooks();
  } else {
    console.log("Usage: petdex-win hooks [install|uninstall]");
  }
}

async function cmdState() {
  const state = args[1];
  if (!state) {
    console.log("Usage: petdex-win state <idle|running|waving|jumping|failed|waiting|review>");
    return;
  }
  await postState(state);
}

// Main
switch (command) {
  case "up":
    await cmdUp();
    break;
  case "down":
    await cmdDown();
    break;
  case "toggle":
    await cmdToggle();
    break;
  case "status":
    await cmdStatus();
    break;
  case "hooks":
    await cmdHooks();
    break;
  case "state":
    await cmdState();
    break;
  default:
    console.log(`
petdex-win - Windows Desktop Pet

Commands:
  up              Start the desktop pet
  down            Stop the desktop pet
  toggle          Toggle the desktop pet
  status          Check if running
  hooks install   Install Claude Code hooks
  hooks uninstall Remove Claude Code hooks
  state <state>   Set animation state
`);
}
