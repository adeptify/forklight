#!/usr/bin/env node

// Bootstrap only: the integrated ForkLight adapter still sends an ordinary prompt.
// Convert this one isolated Writer invocation to Grok CLI's own /goal state machine.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const argv = process.argv.slice(2);

function valueAfter(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function replaceCommaList(flag, transform) {
  const index = argv.indexOf(flag);
  if (index < 0 || index + 1 >= argv.length) return;
  const entries = argv[index + 1].split(",").map((entry) => entry.trim()).filter(Boolean);
  argv[index + 1] = transform(entries).join(",");
}

function removeDenyPair(predicate) {
  for (let index = argv.length - 2; index >= 0; index -= 1) {
    if (argv[index] === "--deny" && predicate(argv[index + 1])) {
      argv.splice(index, 2);
    }
  }
}

const promptIndex = argv.indexOf("-p");
const prompt = promptIndex >= 0 && promptIndex + 1 < argv.length ? argv[promptIndex + 1] : "";
const workspace = valueAfter("--cwd") ?? process.cwd();
const sessionId = valueAfter("--resume") ?? valueAfter("--session-id");
const grokHome = process.env.GROK_HOME;
const forkLightResume = argv.includes("--resume");

if (!prompt || !sessionId || !grokHome) {
  process.stderr.write("ForkLight native Goal bootstrap is missing prompt, session id, or GROK_HOME.\n");
  process.exit(64);
}

const statePath = path.join(
  grokHome,
  "sessions",
  encodeURIComponent(workspace),
  sessionId,
  "goal",
  "state.json",
);

let priorStatus;
if (existsSync(statePath)) {
  try {
    priorStatus = JSON.parse(readFileSync(statePath, "utf8")).status;
  } catch {
    process.stderr.write("ForkLight native Goal bootstrap found unreadable existing Goal state.\n");
    process.exit(65);
  }
}

if (promptIndex < 0) {
  process.stderr.write("ForkLight native Goal bootstrap requires headless -p mode.\n");
  process.exit(64);
}

// A paused/blocked/active native Goal resumes its own durable objective. A typed
// ForkLight correction after native completion starts a successor Goal with the
// complete correction contract already assembled by ForkLight.
argv[promptIndex + 1] = forkLightResume && priorStatus !== "complete"
  ? "/goal resume"
  : `/goal ${prompt}`;

replaceCommaList("--tools", (entries) =>
  Array.from(new Set([
    ...entries,
    "run_terminal_cmd",
    "get_task_output",
    "kill_task",
    "wait_tasks",
    "Agent",
  ])));
replaceCommaList("--disallowed-tools", (entries) =>
  entries.filter((entry) => entry !== "run_terminal_cmd" && entry !== "Agent"));

removeDenyPair((rule) => rule === "Agent");
removeDenyPair((rule) => rule === `Write(${grokHome}/**)` || rule === `Edit(${grokHome}/**)`);

const protectedRuntimeFiles = [
  path.join(grokHome, "auth.json"),
  path.join(grokHome, "agent_id"),
  path.join(grokHome, "config.json"),
  path.join(grokHome, "settings.json"),
  statePath,
];
for (const protectedPath of protectedRuntimeFiles) {
  argv.push("--deny", `Write(${protectedPath})`, "--deny", `Edit(${protectedPath})`);
}
argv.push("--deny", "Bash");

const child = spawn(REAL_GROK, argv, {
  cwd: workspace,
  env: {
    ...process.env,
    GROK_GOAL: "1",
    GROK_WORKFLOWS: "1",
    GROK_GOAL_USE_CURRENT_MODEL_ONLY: "1",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`ForkLight native Goal bootstrap could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
