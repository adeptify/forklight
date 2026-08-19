import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claudeMcpInstalled,
  installMainMcp,
  isTomlTableHeaderLine,
  removeClaudeMcpServer,
  removeTomlTable,
  statusMainInstall,
  uninstallMainMcp,
  upsertClaudeMcpServer,
  upsertTomlMcpServer,
} from "../src/hub/main-install.js";
import { projectMainSetupResult } from "../src/setup/status.js";

test("isTomlTableHeaderLine rejects array literals inside values", () => {
  assert.equal(isTomlTableHeaderLine("[mcp_servers.forklight]"), true);
  assert.equal(isTomlTableHeaderLine("  [mcp_servers.forklight.env]  "), true);
  assert.equal(isTomlTableHeaderLine("[[plugins]]"), true);
  assert.equal(isTomlTableHeaderLine('args = []'), false);
  assert.equal(isTomlTableHeaderLine('args = ["/tmp/mcp.js"]'), false);
  assert.equal(isTomlTableHeaderLine('command = "forklight-mcp"'), false);
  assert.equal(isTomlTableHeaderLine("enabled = true"), false);
});

test("removeTomlTable does not stop at args = [] brackets", () => {
  const content = [
    "model = \"x\"",
    "",
    "[mcp_servers.forklight]",
    'command = "forklight-mcp"',
    "args = []",
    "enabled = true",
    "",
    "[other]",
    "a = 1",
    "",
  ].join("\n");
  const next = removeTomlTable(content, "mcp_servers.forklight");
  assert.doesNotMatch(next, /forklight/);
  assert.doesNotMatch(next, /^\]$/m);
  assert.doesNotMatch(next, /enabled = true/);
  assert.doesNotMatch(next, /args\s*=/);
  assert.match(next, /model = "x"/);
  assert.match(next, /\[other\]/);
  assert.match(next, /a = 1/);
});

test("removeTomlTable strips full body when args is non-empty array", () => {
  const content = [
    "[mcp_servers.forklight]",
    'command = "node"',
    'args = ["/opt/forklight/mcp.js", "--flag"]',
    "enabled = true",
    "",
    "[keep]",
    "x = 1",
    "",
  ].join("\n");
  const next = removeTomlTable(content, "mcp_servers.forklight");
  assert.doesNotMatch(next, /forklight|mcp\.js|enabled|--flag/);
  assert.match(next, /\[keep\]/);
});

test("removeTomlTable strips server and env tables independently", () => {
  const content = [
    'model = "x"',
    "",
    "[mcp_servers.forklight]",
    'command = "forklight-mcp"',
    "args = []",
    "enabled = true",
    "",
    "[mcp_servers.forklight.env]",
    'FORKLIGHT_HOME = "/tmp"',
    "",
    "[other]",
    "a = 1",
    "",
  ].join("\n");
  let next = removeTomlTable(content, "mcp_servers.forklight");
  // env subtable is a different header and must still be present until stripped
  assert.match(next, /\[mcp_servers\.forklight\.env\]/);
  next = removeTomlTable(next, "mcp_servers.forklight.env");
  assert.doesNotMatch(next, /forklight/);
  assert.doesNotMatch(next, /FORKLIGHT_HOME/);
  assert.match(next, /\[other\]/);
  assert.match(next, /model = "x"/);
});

test("upsertTomlMcpServer inserts and replaces forklight block", () => {
  const launch = { command: "/usr/local/bin/forklight-mcp", args: [] as string[] };
  const first = upsertTomlMcpServer("# comment\n", "forklight", launch);
  assert.match(first, /\[mcp_servers\.forklight\]/);
  assert.match(first, /command = "\/usr\/local\/bin\/forklight-mcp"/);
  assert.match(first, /args = \[\]/);
  assert.match(first, /enabled = true/);

  const second = upsertTomlMcpServer(first, "forklight", {
    command: "node",
    args: ["/tmp/mcp.js"],
    env: { FORKLIGHT_HOME: "/tmp/fl" },
  });
  assert.equal((second.match(/\[mcp_servers\.forklight\]/g) ?? []).length, 1);
  assert.equal((second.match(/\[mcp_servers\.forklight\.env\]/g) ?? []).length, 1);
  assert.match(second, /command = "node"/);
  assert.match(second, /args = \["\/tmp\/mcp\.js"\]/);
  assert.match(second, /FORKLIGHT_HOME = "\/tmp\/fl"/);
  // no leftover junk from the previous empty-args table
  assert.doesNotMatch(second, /^\]$/m);
  assert.equal((second.match(/enabled = true/g) ?? []).length, 1);
});

test("upsert strips prior main+env tables including empty args before rewrite", () => {
  // Prior install wrote empty args + env; reinstall must not leave duplicates
  // or mid-table residue from the old regex that stopped at `args = []`.
  const prior = upsertTomlMcpServer('model = "keep"\n', "forklight", {
    command: "old-cmd",
    args: [],
    env: { FORKLIGHT_HOME: "/old-home" },
  });
  assert.match(prior, /args = \[\]/);
  assert.match(prior, /\[mcp_servers\.forklight\.env\]/);

  const clean = upsertTomlMcpServer(prior, "forklight", {
    command: "forklight-mcp",
    args: ["/new/mcp.js"],
    env: { FORKLIGHT_HOME: "/new-home" },
  });
  assert.equal((clean.match(/\[mcp_servers\.forklight\]/g) ?? []).length, 1);
  assert.equal((clean.match(/\[mcp_servers\.forklight\.env\]/g) ?? []).length, 1);
  assert.equal((clean.match(/enabled = true/g) ?? []).length, 1);
  assert.match(clean, /command = "forklight-mcp"/);
  assert.match(clean, /args = \["\/new\/mcp\.js"\]/);
  assert.match(clean, /FORKLIGHT_HOME = "\/new-home"/);
  assert.doesNotMatch(clean, /old-cmd|old-home/);
  assert.doesNotMatch(clean, /^\]$/m);
  assert.match(clean, /model = "keep"/);
});

test("upsert removes orphaned env subtable when main table is missing", () => {
  const orphaned = [
    'model = "keep"',
    "",
    "[mcp_servers.forklight.env]",
    'FORKLIGHT_HOME = "/orphan"',
    "",
    "[other]",
    "a = 1",
    "",
  ].join("\n");
  const clean = upsertTomlMcpServer(orphaned, "forklight", {
    command: "forklight-mcp",
    args: [],
  });
  assert.equal((clean.match(/\[mcp_servers\.forklight\]/g) ?? []).length, 1);
  // No env in new launch → orphaned env must be gone, no new env table either
  assert.doesNotMatch(clean, /\[mcp_servers\.forklight\.env\]/);
  assert.doesNotMatch(clean, /orphan|FORKLIGHT_HOME/);
  assert.match(clean, /\[other\]/);
  assert.match(clean, /model = "keep"/);
});

test("claude MCP upsert/remove round-trip", () => {
  const launch = { command: "forklight-mcp", args: [] as string[] };
  const doc = upsertClaudeMcpServer({}, "forklight", launch);
  assert.equal(claudeMcpInstalled(doc, "forklight"), true);
  const servers = doc.mcpServers as Record<string, { command: string } | undefined>;
  assert.equal(servers.forklight?.command, "forklight-mcp");
  const removed = removeClaudeMcpServer(doc, "forklight");
  assert.equal(claudeMcpInstalled(removed, "forklight"), false);
});

test("installMainMcp for claude-code backs up and writes MCP", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-main-claude-"));
  const targetPath = path.join(home, ".claude.json");
  const backupRoot = path.join(home, "backups");
  await writeFile(targetPath, `${JSON.stringify({ theme: "dark" }, null, 2)}\n`, "utf8");

  const result = await installMainMcp("claude-code", {
    home,
    targetPath,
    backupRoot,
    launch: { command: "forklight-mcp", args: [] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.ok(result.backupPath);

  const raw = await readFile(targetPath, "utf8");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(doc.theme, "dark");
  assert.equal(claudeMcpInstalled(doc, "forklight"), true);

  const status = await statusMainInstall("claude-code", { home, targetPath });
  assert.equal(status.installed, true);

  const un = await uninstallMainMcp("claude-code", { home, targetPath, backupRoot });
  assert.equal(un.ok, true);
  assert.equal(un.installed, false);
  const after = JSON.parse(await readFile(targetPath, "utf8")) as Record<string, unknown>;
  assert.equal(claudeMcpInstalled(after, "forklight"), false);
  assert.equal(after.theme, "dark");
});

test("toml install/uninstall/reinstall is clean with empty args", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-main-empty-args-"));
  const targetPath = path.join(home, ".grok", "config.toml");
  const backupRoot = path.join(home, "backups");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, 'model = "grok"\nother = true\n', "utf8");

  const installed = await installMainMcp("grok-build", {
    home,
    targetPath,
    backupRoot,
    launch: { command: "forklight-mcp", args: [] },
  });
  assert.equal(installed.ok, true);
  let content = await readFile(targetPath, "utf8");
  assert.match(content, /\[mcp_servers\.forklight\]/);
  assert.match(content, /args = \[\]/);
  assert.equal((content.match(/\[mcp_servers\.forklight\]/g) ?? []).length, 1);

  const un = await uninstallMainMcp("grok-build", { home, targetPath, backupRoot });
  assert.equal(un.ok, true);
  content = await readFile(targetPath, "utf8");
  assert.doesNotMatch(content, /mcp_servers\.forklight|forklight-mcp|enabled = true/);
  assert.doesNotMatch(content, /^\]$/m);
  assert.doesNotMatch(content, /args\s*=/);
  assert.match(content, /model = "grok"/);
  assert.match(content, /other = true/);

  const reinstalled = await installMainMcp("grok-build", {
    home,
    targetPath,
    backupRoot,
    launch: { command: "forklight-mcp", args: [] },
  });
  assert.equal(reinstalled.ok, true);
  content = await readFile(targetPath, "utf8");
  assert.equal((content.match(/\[mcp_servers\.forklight\]/g) ?? []).length, 1);
  assert.equal((content.match(/enabled = true/g) ?? []).length, 1);
  assert.match(content, /model = "grok"/);
});

test("toml install/uninstall/reinstall is clean with non-empty args and env", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-main-args-env-"));
  const targetPath = path.join(home, ".codex", "config.toml");
  const backupRoot = path.join(home, "backups");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, "[features]\nfoo = true\n", "utf8");

  const launch = {
    command: "node",
    args: ["/opt/forklight/mcp.js", "--always-approve"],
    env: { FORKLIGHT_HOME: home },
  };

  const first = await installMainMcp("codex", {
    home,
    targetPath,
    backupRoot,
    codexViaPlugin: false,
    launch,
  });
  assert.equal(first.ok, true);
  let content = await readFile(targetPath, "utf8");
  assert.match(content, /\[mcp_servers\.forklight\]/);
  assert.match(content, /\[mcp_servers\.forklight\.env\]/);
  assert.match(content, /--always-approve/);
  assert.match(content, /\[features\]/);

  const un = await uninstallMainMcp("codex", { home, targetPath, backupRoot });
  assert.equal(un.ok, true);
  content = await readFile(targetPath, "utf8");
  assert.doesNotMatch(content, /forklight|mcp\.js|FORKLIGHT_HOME|enabled = true/);
  assert.doesNotMatch(content, /^\]$/m);
  assert.match(content, /\[features\]/);
  assert.match(content, /foo = true/);

  // Reinstall with different launch — must not leave duplicate env tables
  const second = await installMainMcp("codex", {
    home,
    targetPath,
    backupRoot,
    codexViaPlugin: false,
    launch: {
      command: "node",
      args: ["/opt/forklight/mcp-v2.js"],
      env: { FORKLIGHT_HOME: `${home}-v2` },
    },
  });
  assert.equal(second.ok, true);
  content = await readFile(targetPath, "utf8");
  assert.equal((content.match(/\[mcp_servers\.forklight\]/g) ?? []).length, 1);
  assert.equal((content.match(/\[mcp_servers\.forklight\.env\]/g) ?? []).length, 1);
  assert.match(content, /mcp-v2\.js/);
  assert.match(content, new RegExp(`${home}-v2`.replaceAll("/", "\\/")));
  assert.doesNotMatch(content, /mcp\.js"|--always-approve/);
  assert.match(content, /\[features\]/);
});

test("installMainMcp for grok-build writes toml with backup", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-main-grok-"));
  const targetPath = path.join(home, ".grok", "config.toml");
  const backupRoot = path.join(home, "backups");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, 'model = "grok"\n', "utf8");

  const result = await installMainMcp("grok-build", {
    home,
    targetPath,
    backupRoot,
    launch: {
      command: "node",
      args: ["/opt/forklight/mcp.js"],
      env: { FORKLIGHT_HOME: home },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.ok(result.backupPath);
  const projected = projectMainSetupResult(result, "mcp");
  assert.equal(projected.newSessionNeeded, true);
  assert.equal(projected.backupPath, result.backupPath);

  const content = await readFile(targetPath, "utf8");
  assert.match(content, /model = "grok"/);
  assert.match(content, /\[mcp_servers\.forklight\]/);
  assert.match(content, /command = "node"/);
  assert.match(content, /FORKLIGHT_HOME = /);

  const status = await statusMainInstall("grok-build", { home, targetPath });
  assert.equal(status.installed, true);

  const un = await uninstallMainMcp("grok-build", { home, targetPath, backupRoot });
  assert.equal(un.ok, true);
  const after = await readFile(targetPath, "utf8");
  assert.doesNotMatch(after, /mcp_servers\.forklight/);
  assert.match(after, /model = "grok"/);
});

test("installMainMcp for codex falls back to toml when plugin path forced", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-main-codex-"));
  const targetPath = path.join(home, ".codex", "config.toml");
  const backupRoot = path.join(home, "backups");
  await mkdir(path.dirname(targetPath), { recursive: true });

  const result = await installMainMcp("codex", {
    home,
    targetPath,
    backupRoot,
    codexViaPlugin: false,
    launch: { command: "forklight-mcp", args: [] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  const content = await readFile(targetPath, "utf8");
  assert.match(content, /\[mcp_servers\.forklight\]/);
  assert.match(content, /command = "forklight-mcp"/);
});
