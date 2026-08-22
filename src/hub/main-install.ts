/**
 * Main-client install surface for ForkLight invocation channels.
 *
 * Three independent channels (install / uninstall / status separately):
 *   1. plugin — Codex marketplace only (`codex plugin add|remove|list`)
 *   2. mcp    — pure MCP config write (Codex / Claude Code / Grok)
 *   3. skill  — pure SKILL.md file write (same three clients)
 *
 * `installMainComponent(client, component)` is the Hub API entry.
 * `installMainFull` / `uninstallMainFull` are bulk helpers (component: "all").
 *
 * Never writes provider API keys into Main configs — only forklight-mcp paths.
 */

import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MainClientId = "codex" | "claude-code" | "grok-build";

export interface McpLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type MainInstallComponent = "plugin" | "mcp" | "skill" | "all";

export interface InstallResult {
  client: MainClientId;
  ok: boolean;
  action: "installed" | "uninstalled" | "noop" | "error";
  targetPath?: string;
  backupPath?: string;
  message: string;
  /** Channel present (MCP config / skill file / plugin). */
  installed: boolean;
  component?: MainInstallComponent;
  skillInstalled?: boolean;
  skillPath?: string;
  /** Whether this client supports Codex-style plugins. */
  supported?: boolean;
}

export interface ChannelStatus {
  supported: boolean;
  installed: boolean;
  path?: string;
  message: string;
}

export interface MainSurfaceStatus {
  client: MainClientId;
  ok: boolean;
  /** Codex plugin marketplace install (Codex only). */
  plugin: ChannelStatus;
  mcp: InstallResult;
  skill: ChannelStatus;
  message: string;
}

function resolveForklightMcpLaunch(home = process.env.FORKLIGHT_HOME): McpLaunch {
  let command = "forklight-mcp";
  try {
    command = execFileSync("which", ["forklight-mcp"], { encoding: "utf8" }).trim() || command;
  } catch {
    // Fall back to package dist entry when not linked globally.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(here, "..", "mcp", "main.js");
    command = process.execPath;
    return {
      command,
      args: [candidate],
      ...(home === undefined ? {} : { env: { FORKLIGHT_HOME: home } }),
    };
  }
  return {
    command,
    args: [],
    ...(home === undefined ? {} : { env: { FORKLIGHT_HOME: home } }),
  };
}

export async function backupFile(targetPath: string, backupRoot: string): Promise<string | undefined> {
  try {
    await readFile(targetPath);
  } catch {
    return undefined;
  }
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(backupRoot, `${path.basename(targetPath)}.${stamp}.bak`);
  await copyFile(targetPath, backupPath);
  return backupPath;
}

async function atomicWrite(targetPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents, { mode: 0o600 });
  await rename(tmp, targetPath);
}

/**
 * TOML table header lines only (e.g. `[a.b]`, `[[array]]`).
 * Values like `args = []` contain brackets but are NOT headers.
 */
export function isTomlTableHeaderLine(line: string): boolean {
  return /^\s*\[+[^\]]+\]+\s*$/.test(line);
}

/**
 * Remove every TOML table whose header is exactly `[header]`, through
 * the line before the next table-header line (or EOF). Line-based so
 * array literals such as `args = []` do not truncate the table early.
 */
export function removeTomlTable(content: string, header: string): string {
  const target = `[${header}]`;
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Skip the empty string that split leaves after a trailing newline —
    // it is not a table body line we need to preserve specially.
    if (line.trim() === target) {
      i += 1;
      while (i < lines.length) {
        const body = lines[i]!;
        // Preserve the trailing empty slot for re-join; stop only on real headers.
        if (body === "" && i === lines.length - 1) break;
        if (isTomlTableHeaderLine(body)) break;
        i += 1;
      }
      continue;
    }
    out.push(line);
    i += 1;
  }
  let result = out.join("\n");
  // Drop leading blank lines introduced by removing a leading table.
  result = result.replace(/^\n+/, "");
  // Collapse 3+ consecutive newlines to a double blank line.
  result = result.replace(/\n{3,}/g, "\n\n");
  if (result.trim().length === 0) {
    return content.length === 0 ? "" : "\n";
  }
  // Normalize: no trailing spaces, single trailing newline.
  return `${result.replace(/\s+$/, "")}\n`;
}

export function upsertTomlMcpServer(
  content: string,
  serverName: string,
  launch: McpLaunch,
): string {
  const header = `mcp_servers.${serverName}`;
  // Always strip main + env subtable so reinstall cannot leave orphans
  // (args = [] used to truncate regex-based removal mid-table).
  let next = removeTomlTable(content, header);
  next = removeTomlTable(next, `${header}.env`);
  next = next.trimEnd();
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  const argsLiteral = launch.args.length === 0
    ? "[]"
    : `[${launch.args.map((a) => JSON.stringify(a)).join(", ")}]`;
  const envLines = launch.env === undefined
    ? ""
    : Object.entries(launch.env)
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n");
  const block = [
    "",
    `[${header}]`,
    `command = ${JSON.stringify(launch.command)}`,
    `args = ${argsLiteral}`,
    "enabled = true",
    ...(envLines
      ? [`[mcp_servers.${serverName}.env]`, envLines]
      : []),
    "",
  ].join("\n");
  return `${next}${block}`;
}

export function claudeMcpInstalled(doc: unknown, serverName = "forklight"): boolean {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return false;
  const servers = (doc as { mcpServers?: unknown }).mcpServers;
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) return false;
  return serverName in (servers as Record<string, unknown>);
}

export function upsertClaudeMcpServer(
  doc: Record<string, unknown>,
  serverName: string,
  launch: McpLaunch,
): Record<string, unknown> {
  const next = structuredClone(doc);
  const servers = (next.mcpServers !== null
    && typeof next.mcpServers === "object"
    && !Array.isArray(next.mcpServers))
    ? { ...(next.mcpServers as Record<string, unknown>) }
    : {};
  servers[serverName] = {
    command: launch.command,
    ...(launch.args.length > 0 ? { args: launch.args } : {}),
    ...(launch.env === undefined ? {} : { env: launch.env }),
  };
  next.mcpServers = servers;
  return next;
}

export function removeClaudeMcpServer(
  doc: Record<string, unknown>,
  serverName: string,
): Record<string, unknown> {
  const next = structuredClone(doc);
  const servers = (next.mcpServers !== null
    && typeof next.mcpServers === "object"
    && !Array.isArray(next.mcpServers))
    ? { ...(next.mcpServers as Record<string, unknown>) }
    : {};
  delete servers[serverName];
  next.mcpServers = servers;
  return next;
}

export function defaultPaths(home = homedir()): Record<MainClientId, string> {
  return {
    "claude-code": path.join(home, ".claude.json"),
    "codex": path.join(home, ".codex", "config.toml"),
    "grok-build": path.join(home, ".grok", "config.toml"),
  };
}

export function defaultBackupRoot(home = homedir()): string {
  return path.join(home, ".forklight", "hub-backups");
}

export async function statusMainInstall(
  client: MainClientId,
  options: { home?: string; targetPath?: string; serverName?: string } = {},
): Promise<InstallResult> {
  const serverName = options.serverName ?? "forklight";
  const targetPath = options.targetPath ?? defaultPaths(options.home)[client];
  try {
    const raw = await readFile(targetPath, "utf8");
    if (client === "claude-code") {
      const doc = JSON.parse(raw) as Record<string, unknown>;
      const installed = claudeMcpInstalled(doc, serverName);
      return {
        client,
        ok: true,
        action: "noop",
        targetPath,
        message: installed ? "ForkLight MCP is installed" : "ForkLight MCP is not installed",
        installed,
      };
    }
    const installed = raw.includes(`[mcp_servers.${serverName}]`);
    return {
      client,
      ok: true,
      action: "noop",
      targetPath,
      message: installed ? "ForkLight MCP is installed" : "ForkLight MCP is not installed",
      installed,
    };
  } catch {
    return {
      client,
      ok: true,
      action: "noop",
      targetPath,
      message: "Config file not found (will be created on install)",
      installed: false,
    };
  }
}

/**
 * Install pure MCP config only (no plugin CLI).
 * Codex: ~/.codex/config.toml; Claude: ~/.claude.json; Grok: ~/.grok/config.toml.
 */
export async function installMainMcp(
  client: MainClientId,
  options: {
    home?: string;
    targetPath?: string;
    backupRoot?: string;
    serverName?: string;
    launch?: McpLaunch;
    /** @deprecated Plugin install is a separate channel — ignored. */
    codexViaPlugin?: boolean;
    packageRoot?: string;
  } = {},
): Promise<InstallResult> {
  const serverName = options.serverName ?? "forklight";
  const targetPath = options.targetPath ?? defaultPaths(options.home)[client];
  const backupRoot = options.backupRoot ?? defaultBackupRoot(options.home);
  const launch = options.launch ?? resolveForklightMcpLaunch(process.env.FORKLIGHT_HOME);

  try {
    const backupPath = await backupFile(targetPath, backupRoot);
    if (client === "claude-code") {
      let doc: Record<string, unknown> = {};
      try {
        doc = JSON.parse(await readFile(targetPath, "utf8")) as Record<string, unknown>;
      } catch {
        doc = {};
      }
      const next = upsertClaudeMcpServer(doc, serverName, launch);
      await atomicWrite(targetPath, `${JSON.stringify(next, null, 2)}\n`);
      return {
        client,
        ok: true,
        action: "installed",
        component: "mcp",
        targetPath,
        ...(backupPath === undefined ? {} : { backupPath }),
        message: `Installed ForkLight MCP into ${targetPath}`,
        installed: true,
      };
    }

    let content = "";
    try {
      content = await readFile(targetPath, "utf8");
    } catch {
      content = "";
    }
    const next = upsertTomlMcpServer(content, serverName, launch);
    await atomicWrite(targetPath, next.endsWith("\n") ? next : `${next}\n`);
    return {
      client,
      ok: true,
      action: "installed",
      component: "mcp",
      targetPath,
      ...(backupPath === undefined ? {} : { backupPath }),
      message: `Installed ForkLight MCP into ${targetPath}`,
      installed: true,
    };
  } catch (error) {
    return {
      client,
      ok: false,
      action: "error",
      component: "mcp",
      targetPath,
      message: error instanceof Error ? error.message : String(error),
      installed: false,
    };
  }
}

export async function uninstallMainMcp(
  client: MainClientId,
  options: {
    home?: string;
    targetPath?: string;
    backupRoot?: string;
    serverName?: string;
  } = {},
): Promise<InstallResult> {
  const serverName = options.serverName ?? "forklight";
  const targetPath = options.targetPath ?? defaultPaths(options.home)[client];
  const backupRoot = options.backupRoot ?? defaultBackupRoot(options.home);
  try {
    const raw = await readFile(targetPath, "utf8");
    const backupPath = await backupFile(targetPath, backupRoot);
    if (client === "claude-code") {
      const doc = JSON.parse(raw) as Record<string, unknown>;
      const next = removeClaudeMcpServer(doc, serverName);
      await atomicWrite(targetPath, `${JSON.stringify(next, null, 2)}\n`);
    } else {
      // Line-based strip of main table then env subtable (order independent).
      let cleaned = removeTomlTable(raw, `mcp_servers.${serverName}`);
      cleaned = removeTomlTable(cleaned, `mcp_servers.${serverName}.env`);
      await atomicWrite(targetPath, cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`);
    }
    return {
      client,
      ok: true,
      action: "uninstalled",
      component: "mcp",
      targetPath,
      ...(backupPath === undefined ? {} : { backupPath }),
      message: `Removed ForkLight MCP from ${targetPath}`,
      installed: false,
    };
  } catch (error) {
    return {
      client,
      ok: false,
      action: "error",
      component: "mcp",
      targetPath,
      message: error instanceof Error ? error.message : String(error),
      installed: false,
    };
  }
}

// --- Codex plugin channel (separate from MCP config and Skill file) ---

/** Pure helper: detect forklight plugin lines in `codex plugin list` output. */
export function parseCodexPluginList(output: string): {
  installed: boolean;
  pluginId?: string;
} {
  // e.g. "forklight@personal  installed, enabled  0.2.0  /path"
  const re = /(forklight@[^\s]+)\s+installed/i;
  const m = re.exec(output);
  if (!m || m[1] === undefined) return { installed: false };
  return { installed: true, pluginId: m[1] };
}

export async function statusMainPlugin(
  client: MainClientId,
): Promise<ChannelStatus> {
  if (client !== "codex") {
    return {
      supported: false,
      installed: false,
      message: "Plugin install is Codex-only (Claude Code / Grok use MCP + Skill)",
    };
  }
  try {
    const out = execFileSync("codex", ["plugin", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = parseCodexPluginList(out);
    return {
      supported: true,
      installed: parsed.installed,
      ...(parsed.pluginId === undefined ? {} : { path: parsed.pluginId }),
      message: parsed.installed
        ? `Codex plugin installed (${parsed.pluginId})`
        : "Codex plugin not installed",
    };
  } catch (error) {
    return {
      supported: true,
      installed: false,
      message: error instanceof Error
        ? `Could not list Codex plugins: ${error.message}`
        : "Could not list Codex plugins",
    };
  }
}

export async function installMainPlugin(
  client: MainClientId,
  options: { packageRoot?: string } = {},
): Promise<InstallResult> {
  if (client !== "codex") {
    return {
      client,
      ok: false,
      action: "error",
      component: "plugin",
      installed: false,
      supported: false,
      message: "Plugin install is only available for Codex",
    };
  }
  try {
    if (options.packageRoot) {
      try {
        execFileSync("codex", ["plugin", "marketplace", "add", options.packageRoot], {
          stdio: "pipe",
        });
      } catch {
        /* marketplace may already exist */
      }
    }
    // Prefer packaged marketplace id when available; fall back to common names.
    const candidates = ["forklight@adeptify", "forklight@personal"];
    let lastError: unknown;
    for (const id of candidates) {
      try {
        execFileSync("codex", ["plugin", "add", id], { stdio: "pipe" });
        return {
          client,
          ok: true,
          action: "installed",
          component: "plugin",
          installed: true,
          supported: true,
          message: `Installed Codex plugin ${id}`,
          targetPath: id,
        };
      } catch (error) {
        lastError = error;
      }
    }
    // If package root is a local marketplace, try marketplace-local name
    if (options.packageRoot) {
      try {
        execFileSync("codex", ["plugin", "add", "forklight"], { stdio: "pipe" });
        return {
          client,
          ok: true,
          action: "installed",
          component: "plugin",
          installed: true,
          supported: true,
          message: "Installed Codex plugin forklight",
          targetPath: "forklight",
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("codex plugin add failed");
  } catch (error) {
    return {
      client,
      ok: false,
      action: "error",
      component: "plugin",
      installed: false,
      supported: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function uninstallMainPlugin(
  client: MainClientId,
): Promise<InstallResult> {
  if (client !== "codex") {
    return {
      client,
      ok: false,
      action: "error",
      component: "plugin",
      installed: false,
      supported: false,
      message: "Plugin uninstall is only available for Codex",
    };
  }
  try {
    let pluginId = "forklight@adeptify";
    try {
      const out = execFileSync("codex", ["plugin", "list"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = parseCodexPluginList(out);
      if (parsed.pluginId) pluginId = parsed.pluginId;
      else if (!parsed.installed) {
        return {
          client,
          ok: true,
          action: "noop",
          component: "plugin",
          installed: false,
          supported: true,
          message: "Codex plugin was not installed",
        };
      }
    } catch {
      /* try remove with default id */
    }
    execFileSync("codex", ["plugin", "remove", pluginId], { stdio: "pipe" });
    return {
      client,
      ok: true,
      action: "uninstalled",
      component: "plugin",
      installed: false,
      supported: true,
      message: `Removed Codex plugin ${pluginId}`,
      targetPath: pluginId,
    };
  } catch (error) {
    return {
      client,
      ok: false,
      action: "error",
      component: "plugin",
      installed: false,
      supported: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- Skill file install (separate from plugin and MCP) ---

export const SKILL_DIR_NAME = "forklight-orchestrator";

export function defaultSkillPaths(home = homedir()): Record<MainClientId, string> {
  return {
    // Claude Code user skills directory
    "claude-code": path.join(home, ".claude", "skills", SKILL_DIR_NAME, "SKILL.md"),
    // Grok Build / agent skills convention
    "grok-build": path.join(home, ".grok", "skills", SKILL_DIR_NAME, "SKILL.md"),
    // Codex uses the plugin skill tree; path is informational for status
    "codex": path.join(home, ".codex", "skills", SKILL_DIR_NAME, "SKILL.md"),
  };
}

async function readPackagedSkillMarkdown(packageRoot?: string): Promise<string> {
  const candidates = [
    packageRoot
      ? path.join(packageRoot, "plugins", "forklight", "skills", SKILL_DIR_NAME, "SKILL.md")
      : undefined,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "plugins", "forklight", "skills", SKILL_DIR_NAME, "SKILL.md"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "forklight", "skills", SKILL_DIR_NAME, "SKILL.md"),
  ].filter((c): c is string => typeof c === "string");
  for (const c of candidates) {
    try {
      return await readFile(c, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("Packaged forklight-orchestrator SKILL.md not found");
}

export async function statusMainSkill(
  client: MainClientId,
  options: { home?: string; skillPath?: string; packageRoot?: string } = {},
): Promise<ChannelStatus> {
  const skillPath = options.skillPath ?? defaultSkillPaths(options.home)[client];
  try {
    const body = await readFile(skillPath, "utf8");
    const ok = body.includes("forklight") || body.includes("ForkLight");
    return {
      supported: true,
      installed: ok,
      path: skillPath,
      message: ok ? "Skill file installed" : "Skill file present but does not look like ForkLight",
    };
  } catch {
    return {
      supported: true,
      installed: false,
      path: skillPath,
      message: "Skill file not installed",
    };
  }
}

/** Install Skill markdown only (does not install Codex plugin or MCP). */
export async function installMainSkill(
  client: MainClientId,
  options: {
    home?: string;
    skillPath?: string;
    backupRoot?: string;
    packageRoot?: string;
    skillMarkdown?: string;
  } = {},
): Promise<InstallResult> {
  const skillPath = options.skillPath ?? defaultSkillPaths(options.home)[client];
  const backupRoot = options.backupRoot ?? defaultBackupRoot(options.home);
  try {
    const markdown = options.skillMarkdown
      ?? await readPackagedSkillMarkdown(options.packageRoot);
    const backupPath = await backupFile(skillPath, backupRoot);
    await atomicWrite(skillPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    return {
      client,
      ok: true,
      action: "installed",
      component: "skill",
      targetPath: skillPath,
      ...(backupPath === undefined ? {} : { backupPath }),
      message: `Installed ForkLight skill at ${skillPath}`,
      installed: true,
      skillInstalled: true,
      skillPath,
      supported: true,
    };
  } catch (error) {
    return {
      client,
      ok: false,
      action: "error",
      component: "skill",
      targetPath: skillPath,
      message: error instanceof Error ? error.message : String(error),
      installed: false,
      skillInstalled: false,
      skillPath,
      supported: true,
    };
  }
}

export async function uninstallMainSkill(
  client: MainClientId,
  options: {
    home?: string;
    skillPath?: string;
    backupRoot?: string;
  } = {},
): Promise<InstallResult> {
  const skillPath = options.skillPath ?? defaultSkillPaths(options.home)[client];
  const backupRoot = options.backupRoot ?? defaultBackupRoot(options.home);
  try {
    const backupPath = await backupFile(skillPath, backupRoot);
    // Replace with empty removal: write nothing by unlinking via empty + note
    // Use atomic write of empty then delete? Prefer rename away by writing marker then unlink.
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(skillPath);
    } catch {
      /* already gone */
    }
    return {
      client,
      ok: true,
      action: "uninstalled",
      component: "skill",
      targetPath: skillPath,
      ...(backupPath === undefined ? {} : { backupPath }),
      message: `Removed ForkLight skill at ${skillPath}`,
      installed: false,
      skillInstalled: false,
      skillPath,
      supported: true,
    };
  } catch (error) {
    return {
      client,
      ok: false,
      action: "error",
      component: "skill",
      targetPath: skillPath,
      message: error instanceof Error ? error.message : String(error),
      installed: false,
      skillInstalled: false,
      skillPath,
      supported: true,
    };
  }
}

/** Install one or all channels for a Main client. */
export async function installMainComponent(
  client: MainClientId,
  component: MainInstallComponent,
  options: {
    home?: string;
    packageRoot?: string;
    backupRoot?: string;
    launch?: McpLaunch;
  } = {},
): Promise<InstallResult | MainSurfaceStatus> {
  if (component === "plugin") return installMainPlugin(client, options);
  if (component === "mcp") {
    return installMainMcp(client, {
      ...(options.home === undefined ? {} : { home: options.home }),
      ...(options.backupRoot === undefined ? {} : { backupRoot: options.backupRoot }),
      ...(options.launch === undefined ? {} : { launch: options.launch }),
      codexViaPlugin: false,
    });
  }
  if (component === "skill") {
    return installMainSkill(client, {
      ...(options.home === undefined ? {} : { home: options.home }),
      ...(options.packageRoot === undefined ? {} : { packageRoot: options.packageRoot }),
      ...(options.backupRoot === undefined ? {} : { backupRoot: options.backupRoot }),
    });
  }
  return installMainFull(client, options);
}

export async function uninstallMainComponent(
  client: MainClientId,
  component: MainInstallComponent,
  options: { home?: string; backupRoot?: string } = {},
): Promise<InstallResult | MainSurfaceStatus> {
  if (component === "plugin") return uninstallMainPlugin(client);
  if (component === "mcp") return uninstallMainMcp(client, options);
  if (component === "skill") return uninstallMainSkill(client, options);
  return uninstallMainFull(client, options);
}

/** Install all supported channels for a Main client. */
export async function installMainFull(
  client: MainClientId,
  options: {
    home?: string;
    packageRoot?: string;
    backupRoot?: string;
    launch?: McpLaunch;
    codexViaPlugin?: boolean;
  } = {},
): Promise<MainSurfaceStatus> {
  const parts: string[] = [];
  let ok = true;
  if (client === "codex") {
    const plugin = await installMainPlugin(client, {
      ...(options.packageRoot === undefined ? {} : { packageRoot: options.packageRoot }),
    });
    parts.push(plugin.message);
    ok = ok && plugin.ok;
  }
  const mcp = await installMainMcp(client, {
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.backupRoot === undefined ? {} : { backupRoot: options.backupRoot }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
    codexViaPlugin: false,
  });
  parts.push(mcp.message);
  ok = ok && mcp.ok;
  const skill = await installMainSkill(client, {
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.packageRoot === undefined ? {} : { packageRoot: options.packageRoot }),
    ...(options.backupRoot === undefined ? {} : { backupRoot: options.backupRoot }),
  });
  parts.push(skill.message);
  ok = ok && skill.ok;
  return {
    ...(await listMainSurfaceStatusOne(client, options.home, options.packageRoot)),
    ok,
    message: parts.join(" · "),
  };
}

export async function uninstallMainFull(
  client: MainClientId,
  options: { home?: string; backupRoot?: string } = {},
): Promise<MainSurfaceStatus> {
  const parts: string[] = [];
  let ok = true;
  if (client === "codex") {
    const plugin = await uninstallMainPlugin(client);
    parts.push(plugin.message);
    ok = ok && plugin.ok;
  }
  const mcp = await uninstallMainMcp(client, options);
  parts.push(mcp.message);
  ok = ok && mcp.ok;
  const skill = await uninstallMainSkill(client, options);
  parts.push(skill.message);
  ok = ok && skill.ok;
  return {
    ...(await listMainSurfaceStatusOne(client, options.home)),
    ok,
    message: parts.join(" · "),
  };
}

async function listMainSurfaceStatusOne(
  client: MainClientId,
  home = homedir(),
  packageRoot?: string,
): Promise<MainSurfaceStatus> {
  const plugin = await statusMainPlugin(client);
  const mcp = await statusMainInstall(client, { home });
  const skill = await statusMainSkill(client, {
    home,
    ...(packageRoot === undefined ? {} : { packageRoot }),
  });
  return {
    client,
    ok: true,
    plugin,
    mcp: {
      ...mcp,
      component: "mcp",
      skillInstalled: skill.installed,
      ...(skill.path === undefined ? {} : { skillPath: skill.path }),
    },
    skill,
    message: [
      `Plugin: ${plugin.supported ? (plugin.installed ? "yes" : "no") : "n/a"}`,
      `MCP: ${mcp.installed ? "yes" : "no"}`,
      `Skill: ${skill.installed ? "yes" : "no"}`,
    ].join(" · "),
  };
}

export async function listMainSurfaceStatus(
  home = homedir(),
  packageRoot?: string,
): Promise<MainSurfaceStatus[]> {
  const clients: MainClientId[] = ["codex", "claude-code", "grok-build"];
  return Promise.all(clients.map((client) => listMainSurfaceStatusOne(client, home, packageRoot)));
}
