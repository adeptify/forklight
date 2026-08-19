#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildNativePlanInvocation } from "./native-plan-only-bootstrap.mjs";

const workspace = "/task/workspace";
const grokHome = "/task/grok-home";
const invocation = buildNativePlanInvocation({
  argv: [
    "-p", "inspect exact Candidate",
    "--cwd", workspace,
    "--tools", "read_file,list_dir,grep",
    "--disallowed-tools", "run_terminal_cmd,web_search,Agent",
    "--deny", `Write(${grokHome}/**)`,
    "--deny", `Edit(${grokHome}/**)`,
    "--deny", "Agent",
    "--session-id", "11111111-1111-4111-8111-111111111111",
  ],
  cwd: workspace,
  grokHome,
  priorStatus: undefined,
  env: { GROK_HOME: grokHome },
});

assert.equal(invocation.argv[invocation.argv.indexOf("-p") + 1], "/goal inspect exact Candidate");
const tools = invocation.argv[invocation.argv.indexOf("--tools") + 1].split(",");
assert.ok(tools.includes("search_replace"));
assert.ok(tools.includes("write"));
assert.ok(tools.includes("Agent"));
assert.ok(!tools.includes("run_terminal_cmd"));

const disallowed = invocation.argv[invocation.argv.indexOf("--disallowed-tools") + 1].split(",");
assert.ok(disallowed.includes("run_terminal_cmd"));
assert.ok(disallowed.includes("web_search"));
assert.ok(!disallowed.includes("search_replace"));
assert.ok(!disallowed.includes("write"));
assert.ok(!disallowed.includes("Agent"));

const denyRules = invocation.argv.flatMap((value, index) =>
  value === "--deny" ? [invocation.argv[index + 1]] : []);
assert.ok(denyRules.includes(`Write(${workspace}/**)`));
assert.ok(denyRules.includes(`Edit(${workspace}/**)`));
assert.ok(denyRules.includes("Bash"));
assert.ok(!denyRules.includes(`Write(${grokHome}/**)`));
assert.ok(!denyRules.includes(`Edit(${grokHome}/**)`));
assert.ok(denyRules.includes(`Write(${grokHome}/auth.json)`));
assert.ok(denyRules.includes(`Edit(${grokHome}/auth.json)`));
assert.ok(denyRules.includes(`Write(${invocation.statePath})`));
assert.ok(denyRules.includes(`Edit(${invocation.statePath})`));

assert.equal(invocation.env.GROK_GOAL, "1");
assert.equal(invocation.env.GROK_WORKFLOWS, "1");
assert.equal(invocation.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY, "1");
assert.equal(invocation.env.GROK_WRITE_FILE, "1");

const resumed = buildNativePlanInvocation({
  argv: [
    "-p", "new correction",
    "--cwd", workspace,
    "--tools", "read_file,list_dir,grep",
    "--disallowed-tools", "run_terminal_cmd,Agent",
    "--resume", "11111111-1111-4111-8111-111111111111",
  ],
  cwd: workspace,
  grokHome,
  priorStatus: "user_paused",
  env: { GROK_HOME: grokHome },
});
assert.equal(resumed.argv[resumed.argv.indexOf("-p") + 1], "/goal resume");

process.stdout.write("native-plan bootstrap policy verified\n");
