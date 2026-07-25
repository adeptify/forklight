import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  installMainMcp,
  installMainSkill,
  parseCodexPluginList,
  statusMainPlugin,
  statusMainSkill,
  uninstallMainSkill,
} from "../src/hub/main-install.js";

test("parseCodexPluginList detects installed forklight plugin ids", () => {
  const sample = `
Marketplace personal
PLUGIN              STATUS              VERSION
forklight@personal  installed, enabled  0.2.0    /path
other@x             available           1.0
`;
  const parsed = parseCodexPluginList(sample);
  assert.equal(parsed.installed, true);
  assert.equal(parsed.pluginId, "forklight@personal");
  assert.equal(parseCodexPluginList("no plugins here").installed, false);
});

test("MCP install for codex writes toml only (no plugin side effect required)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ch-mcp-"));
  const targetPath = path.join(home, ".codex", "config.toml");
  await mkdir(path.dirname(targetPath), { recursive: true });
  const result = await installMainMcp("codex", {
    home,
    targetPath,
    backupRoot: path.join(home, "bak"),
    codexViaPlugin: false,
    launch: { command: "forklight-mcp", args: [] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.component, "mcp");
  const body = await readFile(targetPath, "utf8");
  assert.match(body, /\[mcp_servers\.forklight\]/);
  assert.doesNotMatch(body, /api_key|sk-/i);
});

test("Skill install is independent of MCP and plugin", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ch-skill-"));
  const skillPath = path.join(home, ".claude", "skills", "forklight-orchestrator", "SKILL.md");
  const skill = await installMainSkill("claude-code", {
    home,
    skillPath,
    skillMarkdown: "---\nname: forklight-orchestrator\n---\n# ForkLight\n",
  });
  assert.equal(skill.ok, true);
  assert.equal(skill.component, "skill");
  const st = await statusMainSkill("claude-code", { home, skillPath });
  assert.equal(st.installed, true);
  // MCP config still absent
  const mcpPath = path.join(home, ".claude.json");
  await writeFile(mcpPath, "{}\n", "utf8");
  const un = await uninstallMainSkill("claude-code", { home, skillPath });
  assert.equal(un.ok, true);
  assert.equal((await statusMainSkill("claude-code", { home, skillPath })).installed, false);
});

test("statusMainPlugin is unsupported for non-codex clients", async () => {
  const st = await statusMainPlugin("claude-code");
  assert.equal(st.supported, false);
  assert.equal(st.installed, false);
});
