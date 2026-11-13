import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PETDEX_RUNTIME = join(homedir(), ".petdex", "runtime");
const TOKEN_PATH = join(PETDEX_RUNTIME, "update-token");

const HOOK_STATES = {
  "PreToolUse": { state: "running", bubble: "Working..." },
  "PostToolUse": { state: "idle", bubble: "" },
  "UserPromptSubmit": { state: "jumping", bubble: "Thinking..." },
  "Stop": { state: "waving", bubble: "Done." },
  "Notification": { state: "waiting", bubble: "Waiting..." },
};

function buildHookCommand(hookEvent) {
  const cfg = HOOK_STATES[hookEvent];
  if (!cfg) return null;

  const statePayload = JSON.stringify({ state: cfg.state, agent_source: "claude-code" });
  const bubblePayload = JSON.stringify({ text: cfg.bubble, agent_source: "claude-code" });

  // Windows-compatible hook command using curl
  const stateCmd = cfg.bubble
    ? `curl -sf -X POST http://127.0.0.1:7777/state -H "x-petdex-update-token: $(cat ${TOKEN_PATH.replace(/\\/g, "/")})" -d '${statePayload}' > NUL 2>&1 & curl -sf -X POST http://127.0.0.1:7777/bubble -H "x-petdex-update-token: $(cat ${TOKEN_PATH.replace(/\\/g, "/")})" -d '${bubblePayload}' > NUL 2>&1`
    : `curl -sf -X POST http://127.0.0.1:7777/state -H "x-petdex-update-token: $(cat ${TOKEN_PATH.replace(/\\/g, "/")})" -d '${statePayload}' > NUL 2>&1`;

  return {
    type: "command",
    command: stateCmd,
  };
}

export function installHooks() {
  const claudeSettingsPath = join(homedir(), ".claude", "settings.json");
  const claudeDir = join(homedir(), ".claude");

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  let settings = {};
  if (existsSync(claudeSettingsPath)) {
    try {
      settings = JSON.parse(readFileSync(claudeSettingsPath, "utf8"));
    } catch {
      console.error("Failed to parse existing settings.json, will create new one");
    }
  }

  // Backup existing settings
  if (existsSync(claudeSettingsPath)) {
    const backupPath = claudeSettingsPath + `.bak.${new Date().toISOString().replace(/:/g, "-")}`;
    copyFileSync(claudeSettingsPath, backupPath);
    console.log(`Backed up settings to ${backupPath}`);
  }

  // Initialize hooks object
  if (!settings.hooks) settings.hooks = {};

  // Install hooks for each event
  for (const [event, _] of Object.entries(HOOK_STATES)) {
    const hookCmd = buildHookCommand(event);
    if (!hookCmd) continue;

    // Remove existing petdex hooks (detected by localhost:7777)
    if (settings.hooks[event]) {
      settings.hooks[event] = settings.hooks[event].filter(
        (hook) => !JSON.stringify(hook).includes("127.0.0.1:7777")
      );
    } else {
      settings.hooks[event] = [];
    }

    // Add our hook
    settings.hooks[event].push({
      hooks: [hookCmd],
    });
  }

  writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Hooks installed in ${claudeSettingsPath}`);
  console.log("Events:", Object.keys(HOOK_STATES).join(", "));
}

export function uninstallHooks() {
  const claudeSettingsPath = join(homedir(), ".claude", "settings.json");

  if (!existsSync(claudeSettingsPath)) {
    console.log("No settings.json found, nothing to uninstall");
    return;
  }

  let settings = {};
  try {
    settings = JSON.parse(readFileSync(claudeSettingsPath, "utf8"));
  } catch {
    console.error("Failed to parse settings.json");
    return;
  }

  if (!settings.hooks) {
    console.log("No hooks found in settings");
    return;
  }

  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(
      (hook) => !JSON.stringify(hook).includes("127.0.0.1:7777")
    );
    removed += before - settings.hooks[event].length;
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Removed ${removed} petdex hook(s) from ${claudeSettingsPath}`);
}
