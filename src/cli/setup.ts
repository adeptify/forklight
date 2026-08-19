import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { forklightHome } from "../core/config.js";
import { isProviderName, type ProviderName } from "../core/providers.js";
import { createKeychainStore } from "../core/secrets.js";
import { SettingsService } from "../core/settings.js";
import {
  installMainComponent,
  statusMainInstall,
  statusMainSkill,
  uninstallMainComponent,
  type MainClientId,
  type MainInstallComponent,
} from "../hub/main-install.js";
import { StateStore } from "../state/store.js";
import { createSystemInspector, SetupService } from "../setup/service.js";
import {
  projectMainSetupResult,
  projectSetupStatus,
  renderSetupStatusHuman,
  renderSetupStatusJson,
} from "../setup/status.js";
import type {
  SetupKeychainStore,
  SetupProviderSelection,
  SetupStatusView,
  SetupSystemInspector,
} from "../setup/types.js";

export const SETUP_USAGE = `  forklight setup status [--json]
      # read-only readiness: fact, reason, and one next action
  forklight setup provider select --provider <name> [--variant <id>] [--model <name>] [--endpoint <url>] [--confirm]
      # local Grok/Codex sign-in, or pipe an API key on stdin after --confirm
  forklight setup worker list [--json]
  forklight setup worker select --profile <id> [--json]
  forklight setup main status [--client <id>] [--json]
  forklight setup main install --client <id> [--component plugin|mcp|skill|all] --confirm [--json]
  forklight setup main uninstall --client <id> [--component plugin|mcp|skill|all] --confirm [--json]
`;

export interface SetupCliDependencies {
  home?: string;
  settings?: Pick<SettingsService, "get" | "update">;
  keychain?: SetupKeychainStore;
  inspector?: SetupSystemInspector;
  stdin?: NodeJS.ReadableStream;
  mainHome?: string;
  packageRoot?: string;
}

export interface SetupCliResult {
  stdout: string;
  json?: unknown;
}

const SECRET_FLAGS = new Set(["--api-key", "--key", "--token", "--password"]);
const MAIN_CLIENTS = new Set<MainClientId>(["codex", "claude-code", "grok-build"]);
const MAIN_COMPONENTS = new Set<MainInstallComponent>(["plugin", "mcp", "skill", "all"]);

export async function runSetupCommand(
  args: string[],
  deps: SetupCliDependencies = {},
): Promise<SetupCliResult> {
  const tokens = args.filter((item) => item !== undefined);
  const json = tokens.includes("--json");
  const rest = tokens.filter((item) => item !== "--json");
  if (deps.packageRoot === undefined) {
    const packageRoot = findSetupPackageRoot();
    if (packageRoot !== undefined) deps = { ...deps, packageRoot };
  }
  const action = rest[0];
  if (action === undefined || action === "status") {
    if (rest.length > 1) {
      throw new Error(`Unexpected setup status argument.\n\n${SETUP_USAGE}`);
    }
    return withSetup(deps, async (ctx) => {
      const status = await collectStatus(ctx.service, ctx.settings, deps.mainHome);
      return {
        stdout: json ? renderSetupStatusJson(status) : renderSetupStatusHuman(status),
        json: status,
      };
    });
  }
  if (action === "provider") {
    return withSetup(deps, (ctx) => handleProvider(rest.slice(1), json, ctx, deps));
  }
  if (action === "worker") {
    return withSetup(deps, (ctx) => handleWorker(rest.slice(1), json, ctx.service));
  }
  if (action === "main") {
    return withSetup(deps, () => handleMain(rest.slice(1), json, deps));
  }
  throw new Error(`Unknown setup command.\n\n${SETUP_USAGE}`);
}

async function handleProvider(
  args: string[],
  json: boolean,
  ctx: SetupContext,
  deps: SetupCliDependencies,
): Promise<SetupCliResult> {
  if (args[0] !== "select") {
    throw new Error(`Unknown provider setup command.\n\n${SETUP_USAGE}`);
  }
  const parsed = parseNamedArgs(args.slice(1), new Set([
    "--provider", "--variant", "--model", "--endpoint",
  ]), new Set(["--confirm"]));
  const providerRaw = requiredValue(parsed, "--provider");
  if (!isProviderName(providerRaw)) {
    throw new Error("Unsupported provider. Use a built-in name such as xai, openai, or deepseek.");
  }
  const selection = selectionFromFlags(ctx.service, providerRaw, parsed);
  const { resolved, mode } = ctx.service.resolveProviderSetup(selection);
  if (mode === "local-sign-in") {
    const result = ctx.service.selectSignedInProvider(selection);
    const workers = ctx.service.listWorkers();
    const next = workers.find((item) => item.provider === result.provider)?.id ?? "grok-4-6-xhigh";
    const payload = {
      fact: `${result.providerLabel} is selected using the local sign-in.`,
      reason: "No API key is stored for this path.",
      next: `forklight setup worker select --profile ${next}`,
      provider: result.provider,
      authMode: result.authMode,
      stored: false,
    };
    return present(json, payload, [
      `fact: ${payload.fact}`,
      `reason: ${payload.reason}`,
      `next: ${payload.next}`,
    ]);
  }
  if (!parsed.switches.has("--confirm")) {
    throw new Error(
      "Storing an API key requires explicit --confirm and the key on stdin. The key must not be passed as a command-line flag.\n"
      + `Example: printf '%s' "$KEY" | forklight setup provider select --provider ${resolved.provider} --variant ${resolved.variant} --confirm`,
    );
  }
  const apiKey = await readStdinSecret(deps.stdin ?? process.stdin);
  const result = ctx.service.commitProvider(selection, apiKey);
  const workers = ctx.service.listWorkers();
  const next = workers.find((item) => item.provider === result.provider)?.id ?? "default";
  const payload = {
    fact: `${result.providerLabel} is stored.`,
    reason: "The API key was saved and settings were updated.",
    next: `forklight setup worker select --profile ${next}`,
    provider: result.provider,
    authMode: result.authMode,
    stored: true,
  };
  return present(json, payload, [
    `fact: ${payload.fact}`,
    `reason: ${payload.reason}`,
    `next: ${payload.next}`,
  ]);
}

function handleWorker(
  args: string[],
  json: boolean,
  service: SetupService,
): SetupCliResult {
  const action = args[0] ?? "list";
  if (action === "list") {
    if (args.length > 1) throw new Error(`Unexpected worker list argument.\n\n${SETUP_USAGE}`);
    const workers = service.listWorkers();
    if (json) return { stdout: `${JSON.stringify({ workers }, null, 2)}\n`, json: { workers } };
    const lines = workers.map((item) => {
      const mark = item.selected ? "*" : " ";
      return `${mark} ${item.id}  ${item.label}  ${item.provider}/${item.model}  ${item.runtime}`;
    });
    return { stdout: `${lines.join("\n")}\n`, json: { workers } };
  }
  if (action !== "select") {
    throw new Error(`Unknown worker setup command.\n\n${SETUP_USAGE}`);
  }
  const parsed = parseNamedArgs(args.slice(1), new Set(["--profile"]), new Set());
  const id = requiredValue(parsed, "--profile");
  const selected = service.selectWorker(id);
  const payload = {
    fact: `${selected.label} is now the selected Worker.`,
    reason: "The built-in profile was selected without editing a settings file.",
    next: `forklight setup main install --client ${mainClientForRuntime(selected.runtime)} --component mcp --confirm`,
    worker: selected,
  };
  return present(json, payload, [
    `fact: ${payload.fact}`,
    `reason: ${payload.reason}`,
    `next: ${payload.next}`,
  ]);
}

async function handleMain(
  args: string[],
  json: boolean,
  deps: SetupCliDependencies,
): Promise<SetupCliResult> {
  const action = args[0] ?? "status";
  if (action === "status") {
    const parsed = parseNamedArgs(args.slice(1), new Set(["--client"]), new Set());
    const client = optionalClient(parsed.values.get("--client"));
    const rows = await listMainRows(deps.mainHome, client);
    if (json) return { stdout: `${JSON.stringify({ mains: rows }, null, 2)}\n`, json: { mains: rows } };
    const lines = rows.map((row) => (
      `${row.client}: mcp=${row.mcp ? "yes" : "no"} skill=${row.skill ? "yes" : "no"}`
    ));
    return { stdout: `${lines.join("\n")}\n`, json: { mains: rows } };
  }
  if (action !== "install" && action !== "uninstall") {
    throw new Error(`Unknown main setup command.\n\n${SETUP_USAGE}`);
  }
  const parsed = parseNamedArgs(
    args.slice(1),
    new Set(["--client", "--component"]),
    new Set(["--confirm"]),
  );
  const client = requiredClient(parsed.values.get("--client"));
  const component = optionalComponent(parsed.values.get("--component"));
  if (!parsed.switches.has("--confirm")) {
    throw new Error(
      `${action === "install" ? "Installing" : "Removing"} a Main connection requires explicit --confirm. `
      + "This changes that Main's local config after making a backup.",
    );
  }
  const options = {
    ...(deps.mainHome === undefined ? {} : { home: deps.mainHome }),
    ...(deps.packageRoot === undefined ? {} : { packageRoot: deps.packageRoot }),
    ...(deps.mainHome === undefined ? {} : { backupRoot: path.join(deps.mainHome, ".forklight", "hub-backups") }),
  };
  const raw = action === "install"
    ? await installMainComponent(client, component, options)
    : await uninstallMainComponent(client, component, options);
  const projected = projectMainSetupResult(raw, component);
  if (!projected.ok) {
    throw new Error(
      `${projected.message} No further Main files were changed. Check the client and component, then retry with --confirm.`,
    );
  }
  const session = projected.newSessionNeeded
    ? `Start a new ${clientLabel(client)} session so it can load the change.`
    : "A new Main session is not required.";
  const backup = projected.backupPath === undefined
    ? "No existing config needed a backup."
    : `Existing config was backed up.`;
  const payload = {
    fact: projected.message,
    reason: backup,
    next: session,
    client,
    component,
    action: projected.action,
    newSessionNeeded: projected.newSessionNeeded,
    ...(projected.backupPath === undefined ? {} : { backupPath: projected.backupPath }),
    ...(projected.targetPath === undefined ? {} : { targetPath: projected.targetPath }),
  };
  return present(json, payload, [
    `fact: ${payload.fact}`,
    `reason: ${payload.reason}`,
    `next: ${payload.next}`,
  ]);
}

export async function readStdinSecret(input: NodeJS.ReadableStream): Promise<string> {
  if ("isTTY" in input && input.isTTY === true) {
    throw new Error(
      "API keys must be piped on stdin. Example: printf '%s' \"$KEY\" | forklight setup provider select --provider deepseek --variant default --confirm",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (value.length === 0) {
    throw new Error("No API key was provided on stdin.");
  }
  return value;
}

function selectionFromFlags(
  service: SetupService,
  provider: ProviderName,
  parsed: ParsedArgs,
): SetupProviderSelection {
  const variant = parsed.values.get("--variant") ?? service.defaultVariantId(provider);
  const model = parsed.values.get("--model");
  const endpoint = parsed.values.get("--endpoint");
  return {
    provider,
    variant,
    ...(model === undefined ? {} : { model }),
    ...(endpoint === undefined ? {} : { endpoint }),
  };
}

async function collectStatus(
  service: SetupService,
  settings: Pick<SettingsService, "get">,
  mainHome: string | undefined,
): Promise<SetupStatusView> {
  const effective = settings.get();
  const mains = await Promise.all((["codex", "claude-code", "grok-build"] as const).map(async (client) => {
    const mcp = await statusMainInstall(client, mainHome === undefined ? {} : { home: mainHome });
    const skill = await statusMainSkill(client, mainHome === undefined ? {} : { home: mainHome });
    return { client, installed: mcp.installed || skill.installed };
  }));
  return projectSetupStatus({
    prerequisites: service.inspectPrerequisites(),
    providers: service.describeProviders(),
    defaultProvider: effective.execution.defaultProvider,
    workers: service.listWorkers(),
    mains,
  });
}

async function listMainRows(mainHome: string | undefined, client: MainClientId | undefined) {
  const clients: MainClientId[] = client === undefined
    ? ["codex", "claude-code", "grok-build"]
    : [client];
  return Promise.all(clients.map(async (id) => {
    const mcp = await statusMainInstall(id, mainHome === undefined ? {} : { home: mainHome });
    const skill = await statusMainSkill(id, mainHome === undefined ? {} : { home: mainHome });
    return { client: id, mcp: mcp.installed, skill: skill.installed, installed: mcp.installed || skill.installed };
  }));
}

interface SetupContext {
  service: SetupService;
  settings: Pick<SettingsService, "get" | "update">;
}

async function withSetup<T>(
  deps: SetupCliDependencies,
  fn: (ctx: SetupContext) => Promise<T> | T,
): Promise<T> {
  const home = deps.home ?? forklightHome();
  const createdStore = deps.settings === undefined ? new StateStore(home) : undefined;
  try {
    const settings = deps.settings ?? new SettingsService(createdStore!);
    const service = new SetupService(
      settings,
      deps.keychain ?? createKeychainStore(),
      deps.inspector ?? createSystemInspector(),
    );
    return await fn({ service, settings });
  } finally {
    createdStore?.close();
  }
}

interface ParsedArgs {
  values: Map<string, string>;
  switches: Set<string>;
}

function parseNamedArgs(
  args: string[],
  valueFlags: Set<string>,
  switchFlags: Set<string>,
): ParsedArgs {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (SECRET_FLAGS.has(token)) {
      throw new Error(
        "API keys cannot be passed as command-line flags. Pipe the key on stdin after --confirm.",
      );
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument.\n\n${SETUP_USAGE}`);
    }
    if (switchFlags.has(token)) {
      switches.add(token);
      continue;
    }
    if (valueFlags.has(token)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${token} requires a value.`);
      }
      if (values.has(token)) throw new Error(`Duplicate ${token}.`);
      values.set(token, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown flag: ${token}. No settings were changed.`);
  }
  return { values, switches };
}

function requiredValue(parsed: ParsedArgs, flag: string): string {
  const value = parsed.values.get(flag);
  if (value === undefined || value.trim() === "") {
    throw new Error(`${flag} is required.\n\n${SETUP_USAGE}`);
  }
  return value;
}

function requiredClient(value: string | undefined): MainClientId {
  if (value === undefined || !MAIN_CLIENTS.has(value as MainClientId)) {
    throw new Error("Unsupported Main client. Use codex, claude-code, or grok-build. No files were changed.");
  }
  return value as MainClientId;
}

function optionalClient(value: string | undefined): MainClientId | undefined {
  if (value === undefined) return undefined;
  return requiredClient(value);
}

function optionalComponent(value: string | undefined): MainInstallComponent {
  if (value === undefined) return "mcp";
  if (!MAIN_COMPONENTS.has(value as MainInstallComponent)) {
    throw new Error("Unsupported component. Use plugin, mcp, skill, or all. No files were changed.");
  }
  return value as MainInstallComponent;
}

function mainClientForRuntime(runtime: string): string {
  if (runtime === "codex-cli") return "codex";
  if (runtime === "claude-code") return "claude-code";
  return "grok-build";
}

function clientLabel(client: MainClientId): string {
  if (client === "claude-code") return "Claude Code";
  if (client === "codex") return "Codex";
  return "Grok";
}

function present(json: boolean, payload: unknown, lines: string[]): SetupCliResult {
  return {
    stdout: json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join("\n")}\n`,
    json: payload,
  };
}

export function findSetupPackageRoot(): string | undefined {
  let candidate = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    candidate = path.dirname(candidate);
  }
  return undefined;
}
