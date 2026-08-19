#!/usr/bin/env node

// Final one-shot recovery bootstrap. It materializes the exact previously
// verified 14-path Candidate in the isolated Task Workspace, then invokes the
// same Grok CLI native /goal boundary with current-model-only forced for every
// native role. It is operational evidence only and is never integrated.

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const SEED_RELATIVE = "goals/forklight-main-led-execution/execution/m2-grok-native-goal/00d99db6-429f-4786-b982-740f19581b31.patch";
const SEED_SHA256 = "e12f45e8d2b9daceebc1b5d53929a455e7ae0965110853b3e677960a0fd42f62";
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

function gitApply(workspace, seedPath, extra) {
  return spawnSync("git", ["apply", "-p2", ...extra, seedPath], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function materializeExactCandidate(workspace) {
  const seedPath = path.join(workspace, SEED_RELATIVE);
  let bytes;
  try {
    bytes = readFileSync(seedPath);
  } catch {
    process.stderr.write("ForkLight current-model-only recovery seed is missing or unreadable.\n");
    process.exit(66);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== SEED_SHA256) {
    process.stderr.write("ForkLight current-model-only recovery seed digest does not match the authorized Candidate.\n");
    process.exit(66);
  }

  const forward = gitApply(workspace, seedPath, ["--check"]);
  if (forward.status === 0) {
    const applied = gitApply(workspace, seedPath, []);
    if (applied.status !== 0) {
      process.stderr.write("ForkLight could not materialize the authorized native Goal Candidate.\n");
      process.exit(66);
    }
    return;
  }

  // A daemon restart may relaunch the same durable Attempt after the seed was
  // already applied and Grok already changed the two authorized delta paths.
  // The other 12 retained paths must still reverse exactly.
  const alreadyApplied = gitApply(workspace, seedPath, [
    "--reverse",
    "--check",
    "--exclude=src/workers/grok.ts",
    "--exclude=tests/worker-runtime.test.ts",
  ]);
  if (alreadyApplied.status !== 0) {
    process.stderr.write("ForkLight native Goal Candidate does not match this Workspace source base.\n");
    process.exit(66);
  }
}

const promptIndex = argv.indexOf("-p");
const prompt = promptIndex >= 0 && promptIndex + 1 < argv.length ? argv[promptIndex + 1] : "";
const workspace = valueAfter("--cwd") ?? process.cwd();
const sessionId = valueAfter("--resume") ?? valueAfter("--session-id");
const grokHome = process.env.GROK_HOME;
const forkLightResume = argv.includes("--resume");

if (!prompt || !sessionId || !grokHome) {
  process.stderr.write("ForkLight native Goal recovery bootstrap is missing prompt, session id, or GROK_HOME.\n");
  process.exit(64);
}

materializeExactCandidate(workspace);

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
    process.stderr.write("ForkLight native Goal recovery bootstrap found unreadable existing Goal state.\n");
    process.exit(65);
  }
}

if (promptIndex < 0) {
  process.stderr.write("ForkLight native Goal recovery bootstrap requires headless -p mode.\n");
  process.exit(64);
}

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
  process.stderr.write(`ForkLight native Goal recovery bootstrap could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
