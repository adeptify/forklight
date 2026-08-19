#!/usr/bin/env node

// Operational bridge for one accepted M2 Work Item. It gives Grok's native
// Goal Planner a Task-local file mutator while preserving a read-only product
// Workspace. It is not the integrated ForkLight native-goal adapter.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function replaceCommaList(argv, flag, transform) {
  const index = argv.indexOf(flag);
  if (index < 0 || index + 1 >= argv.length) return;
  const entries = argv[index + 1].split(",").map((entry) => entry.trim()).filter(Boolean);
  argv[index + 1] = transform(entries).join(",");
}

function removeDenyPair(argv, predicate) {
  for (let index = argv.length - 2; index >= 0; index -= 1) {
    if (argv[index] === "--deny" && predicate(argv[index + 1])) argv.splice(index, 2);
  }
}

export function buildNativePlanInvocation(input) {
  const argv = [...input.argv];
  const promptIndex = argv.indexOf("-p");
  const prompt = promptIndex >= 0 && promptIndex + 1 < argv.length ? argv[promptIndex + 1] : "";
  const workspace = valueAfter(argv, "--cwd") ?? input.cwd;
  const sessionId = valueAfter(argv, "--resume") ?? valueAfter(argv, "--session-id");
  const forkLightResume = argv.includes("--resume");
  const grokHome = input.grokHome;

  if (!prompt || !sessionId || !grokHome) {
    throw new Error("ForkLight native-plan bootstrap is missing prompt, session id, or GROK_HOME.");
  }
  if (promptIndex < 0) throw new Error("ForkLight native-plan bootstrap requires headless -p mode.");

  const sessionRoot = path.join(grokHome, "sessions", encodeURIComponent(workspace), sessionId);
  const statePath = path.join(sessionRoot, "goal", "state.json");
  argv[promptIndex + 1] = forkLightResume && input.priorStatus !== "complete"
    ? "/goal resume"
    : `/goal ${prompt}`;

  replaceCommaList(argv, "--tools", (entries) => Array.from(new Set([
    ...entries,
    "search_replace",
    "write",
    "get_task_output",
    "kill_task",
    "wait_tasks",
    "Agent",
  ])));
  replaceCommaList(argv, "--disallowed-tools", (entries) => entries.filter((entry) =>
    entry !== "search_replace" && entry !== "write" && entry !== "Agent"));

  removeDenyPair(argv, (rule) => rule === "Agent");
  removeDenyPair(argv, (rule) =>
    rule === `Write(${grokHome}/**)` || rule === `Edit(${grokHome}/**)`);

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

  // The Planner may write its Task-local Goal plan under GROK_HOME. Product
  // paths remain immutable to Grok model tools even under --always-approve.
  argv.push(
    "--deny", `Write(${workspace}/**)`,
    "--deny", `Edit(${workspace}/**)`,
    "--deny", "Bash",
  );

  return {
    argv,
    workspace,
    sessionId,
    statePath,
    env: {
      ...input.env,
      GROK_GOAL: "1",
      GROK_WORKFLOWS: "1",
      GROK_GOAL_USE_CURRENT_MODEL_ONLY: "1",
      GROK_WRITE_FILE: "1",
    },
  };
}

function main() {
  const rawArgv = process.argv.slice(2);
  const workspace = valueAfter(rawArgv, "--cwd") ?? process.cwd();
  const sessionId = valueAfter(rawArgv, "--resume") ?? valueAfter(rawArgv, "--session-id");
  const grokHome = process.env.GROK_HOME;
  let priorStatus;

  if (sessionId && grokHome) {
    const statePath = path.join(
      grokHome,
      "sessions",
      encodeURIComponent(workspace),
      sessionId,
      "goal",
      "state.json",
    );
    if (existsSync(statePath)) {
      try {
        priorStatus = JSON.parse(readFileSync(statePath, "utf8")).status;
      } catch {
        process.stderr.write("ForkLight native-plan bootstrap found unreadable existing Goal state.\n");
        process.exit(65);
      }
    }
  }

  let invocation;
  try {
    invocation = buildNativePlanInvocation({
      argv: rawArgv,
      cwd: process.cwd(),
      grokHome,
      priorStatus,
      env: process.env,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(64);
  }

  const child = spawn(REAL_GROK, invocation.argv, {
    cwd: invocation.workspace,
    env: invocation.env,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    process.stderr.write(`ForkLight native-plan bootstrap could not launch Grok: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
