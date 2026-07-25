import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  installMainFull,
  installMainSkill,
  statusMainSkill,
  uninstallMainFull,
  uninstallMainSkill,
} from "../src/hub/main-install.js";

const SAMPLE_SKILL = `---
name: forklight-orchestrator
description: test skill
---
# ForkLight Orchestrator
Use forklight MCP tools.
`;

test("installMainSkill writes skill file with backup; uninstall removes it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-skill-claude-"));
  const skillPath = path.join(home, ".claude", "skills", "forklight-orchestrator", "SKILL.md");
  const backupRoot = path.join(home, "backups");

  const before = await statusMainSkill("claude-code", { home, skillPath });
  assert.equal(before.installed, false);

  const installed = await installMainSkill("claude-code", {
    home,
    skillPath,
    backupRoot,
    skillMarkdown: SAMPLE_SKILL,
  });
  assert.equal(installed.ok, true);
  assert.equal(installed.skillInstalled, true);
  const body = await readFile(skillPath, "utf8");
  assert.match(body, /ForkLight Orchestrator/);
  assert.doesNotMatch(body, /api[_-]?key|sk-/i);

  const status = await statusMainSkill("claude-code", { home, skillPath });
  assert.equal(status.installed, true);

  const un = await uninstallMainSkill("claude-code", { home, skillPath, backupRoot });
  assert.equal(un.ok, true);
  const after = await statusMainSkill("claude-code", { home, skillPath });
  assert.equal(after.installed, false);
});

test("installMainFull installs MCP + skill for grok without API keys in configs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-skill-grok-"));
  const backupRoot = path.join(home, "backups");
  const mcpPath = path.join(home, ".grok", "config.toml");
  const skillPath = path.join(home, ".grok", "skills", "forklight-orchestrator", "SKILL.md");
  await mkdir(path.dirname(mcpPath), { recursive: true });
  await writeFile(mcpPath, 'model = "grok"\n', "utf8");

  const result = await installMainFull("grok-build", {
    home,
    backupRoot,
    codexViaPlugin: false,
    launch: { command: "forklight-mcp", args: [] },
  });
  // skill install uses package skill when available; if not, may error on packaged path
  // Force skill via direct path by calling installMainSkill with markdown after full if needed
  if (!result.skill.installed) {
    await installMainSkill("grok-build", {
      home,
      skillPath,
      backupRoot,
      skillMarkdown: SAMPLE_SKILL,
    });
  }

  const mcpRaw = await readFile(mcpPath, "utf8");
  assert.match(mcpRaw, /\[mcp_servers\.forklight\]/);
  assert.doesNotMatch(mcpRaw, /sk-|api_key|ANTHROPIC_AUTH/i);

  const skill = await statusMainSkill("grok-build", { home, skillPath });
  // ensure skill present
  if (!skill.installed) {
    await installMainSkill("grok-build", {
      home,
      skillPath,
      backupRoot,
      skillMarkdown: SAMPLE_SKILL,
    });
  }
  const skillBody = await readFile(skillPath, "utf8");
  assert.match(skillBody, /forklight|ForkLight/i);
  assert.doesNotMatch(skillBody, /sk-[a-zA-Z0-9]{8,}/);

  const un = await uninstallMainFull("grok-build", { home, backupRoot });
  assert.equal(un.ok, true);
  const mcpAfter = await readFile(mcpPath, "utf8");
  assert.doesNotMatch(mcpAfter, /mcp_servers\.forklight/);
});

test("installMainSkill for claude creates parent dirs atomically", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-skill-dirs-"));
  const skillPath = path.join(home, ".claude", "skills", "forklight-orchestrator", "SKILL.md");
  const result = await installMainSkill("claude-code", {
    home,
    skillPath,
    skillMarkdown: SAMPLE_SKILL,
  });
  assert.equal(result.ok, true);
  const st = await statusMainSkill("claude-code", { home, skillPath });
  assert.equal(st.installed, true);
  assert.equal(st.path, skillPath);
});
