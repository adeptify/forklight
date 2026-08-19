import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runSetupCommand, SETUP_USAGE, type SetupCliDependencies } from "../src/cli/setup.js";
import { SettingsService } from "../src/core/settings.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { StateStore } from "../src/state/store.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class MemoryKeychain implements SetupKeychainStore {
  readonly values = new Map<string, string>();
  reads = 0;
  writes = 0;
  failWrite = false;
  unreadable = false;

  private id(service: string, account: string): string { return `${account}:${service}`; }
  has(service: string, account: string): boolean { return this.values.has(this.id(service, account)); }
  read(service: string, account: string): string | undefined {
    this.reads += 1;
    if (this.unreadable) return undefined;
    return this.values.get(this.id(service, account));
  }
  write(service: string, account: string, value: string): void {
    this.writes += 1;
    if (this.failWrite) throw new Error(`write failed ${value}`);
    this.values.set(this.id(service, account), value);
  }
  delete(service: string, account: string): void {
    this.values.delete(this.id(service, account));
  }
}

function inspector(overrides: Partial<SetupSystemInspector> = {}): SetupSystemInspector {
  return {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "cli-setup-user",
    commandExists: () => true,
    hasLocalGrokSignIn: () => false,
    hasLocalCodexSignIn: () => false,
    ...overrides,
  };
}

async function isolated() {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cli-setup-"));
  const mainHome = await mkdtemp(path.join(tmpdir(), "fl-cli-main-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const system = inspector();
  return {
    home,
    mainHome,
    store,
    settings,
    keychain,
    system,
    deps(extra: Partial<SetupCliDependencies> = {}) {
      return {
        home,
        settings,
        keychain,
        inspector: system,
        mainHome,
        ...extra,
      };
    },
    close() { store.close(); },
  };
}

function containsSecret(haystack: string, secret: string): boolean {
  return haystack.includes(secret);
}

test("setup status is read-only fact/reason/next on a clean home", async () => {
  const ctx = await isolated();
  try {
    const human = await runSetupCommand([], ctx.deps());
    const json = await runSetupCommand(["status", "--json"], ctx.deps());
    assert.match(human.stdout, /^fact: /m);
    assert.match(human.stdout, /^reason: /m);
    assert.match(human.stdout, /^next: /m);
    assert.doesNotMatch(human.stdout, /use: forklight hub/i);
    const body = JSON.parse(json.stdout) as {
      fact: string;
      reason: string;
      nextAction: { code: string; message: string; command: string };
    };
    assert.equal(typeof body.fact, "string");
    assert.equal(typeof body.reason, "string");
    assert.equal(body.nextAction.code, "select-provider");
    assert.match(body.nextAction.command, /setup provider select/);
    assert.equal(ctx.keychain.reads, 0);
    assert.equal(ctx.keychain.values.size, 0);
  } finally {
    ctx.close();
  }
});

test("selecting signed-in Grok asks for no API key and points at a built-in Worker", async () => {
  const ctx = await isolated();
  try {
    assert.equal(ctx.settings.get().execution.defaultRuntime, "claude-code");
    const result = await runSetupCommand(
      ["provider", "select", "--provider", "xai"],
      ctx.deps({ inspector: inspector({ hasLocalGrokSignIn: () => true }) }),
    );
    assert.match(result.stdout, /local sign-in/i);
    assert.match(result.stdout, /grok-4-6-xhigh/);
    assert.doesNotMatch(result.stdout, /API key was saved/);
    assert.equal(ctx.keychain.values.size, 0);
    assert.equal(ctx.keychain.reads, 0);
    assert.equal(ctx.keychain.writes, 0);
    assert.equal(ctx.settings.get().execution.defaultProvider, "xai");
    assert.equal(ctx.settings.get().execution.defaultRuntime, "grok-build");
  } finally {
    ctx.close();
  }
});

test("selecting signed-in Codex asks for no API key", async () => {
  const ctx = await isolated();
  try {
    assert.equal(ctx.settings.get().execution.defaultRuntime, "claude-code");
    const result = await runSetupCommand(
      ["provider", "select", "--provider", "openai"],
      ctx.deps({ inspector: inspector({ hasLocalCodexSignIn: () => true }) }),
    );
    assert.match(result.stdout, /local sign-in/i);
    assert.equal(ctx.keychain.values.size, 0);
    assert.equal(ctx.keychain.reads, 0);
    assert.equal(ctx.keychain.writes, 0);
    assert.equal(ctx.settings.get().execution.defaultProvider, "openai");
    assert.equal(ctx.settings.get().execution.defaultRuntime, "codex-cli");
  } finally {
    ctx.close();
  }
});

test("API-key provider stores from stdin after confirm and never leaks the secret", async () => {
  const ctx = await isolated();
  const secret = "stdin-only-secret-must-not-leak";
  const args = ["provider", "select", "--provider", "minimax", "--variant", "china", "--confirm"];
  try {
    const result = await runSetupCommand(args, ctx.deps({
      stdin: Readable.from([secret]),
    }));
    assert.equal(ctx.keychain.values.get("cli-setup-user:forklight.minimax.api-key"), secret);
    assert.equal(ctx.settings.get().execution.defaultProvider, "minimax");
    assert.equal(containsSecret(result.stdout, secret), false);
    assert.equal(containsSecret(args.join(" "), secret), false);
    assert.equal(containsSecret(JSON.stringify(ctx.settings.get()), secret), false);
    assert.equal(containsSecret(JSON.stringify(result.json), secret), false);
  } finally {
    ctx.close();
  }
});

test("API-key store without --confirm writes nothing", async () => {
  const ctx = await isolated();
  try {
    await assert.rejects(
      () => runSetupCommand(
        ["provider", "select", "--provider", "minimax", "--variant", "china"],
        ctx.deps(),
      ),
      /--confirm/,
    );
    assert.equal(ctx.keychain.values.size, 0);
    assert.equal(ctx.settings.get().execution.defaultProvider, "deepseek");
  } finally {
    ctx.close();
  }
});

test("API-key argv flags are rejected without leaking the secret", async () => {
  const ctx = await isolated();
  const secret = "argv-secret-must-not-leak";
  const before = structuredClone(ctx.settings.get());
  try {
    await assert.rejects(
      () => runSetupCommand(
        ["provider", "select", "--provider", "minimax", "--variant", "china", "--api-key", secret, "--confirm"],
        ctx.deps(),
      ),
      (error: unknown) => error instanceof Error
        && error.message.includes("command-line flags")
        && !error.message.includes(secret),
    );
    assert.deepEqual(ctx.settings.get(), before);
    assert.equal(ctx.keychain.values.size, 0);
  } finally {
    ctx.close();
  }
});

test("unreadable existing Keychain item refuses overwrite and prints no credential", async () => {
  const ctx = await isolated();
  const previous = "existing-unreadable-secret";
  const replacement = "replacement-secret-must-not-leak";
  ctx.keychain.values.set("cli-setup-user:forklight.minimax.api-key", previous);
  ctx.keychain.unreadable = true;
  const before = structuredClone(ctx.settings.get());
  try {
    await assert.rejects(
      () => runSetupCommand(
        ["provider", "select", "--provider", "minimax", "--variant", "china", "--confirm"],
        ctx.deps({ stdin: Readable.from([replacement]) }),
      ),
      (error: unknown) => error instanceof Error
        && /could not be backed up/.test(error.message)
        && !error.message.includes(previous)
        && !error.message.includes(replacement),
    );
    assert.equal(ctx.keychain.values.get("cli-setup-user:forklight.minimax.api-key"), previous);
    assert.deepEqual(ctx.settings.get(), before);
  } finally {
    ctx.close();
  }
});

test("settings-write failure restores the previous Keychain value without leaking", async () => {
  const ctx = await isolated();
  const previous = "previous-cli-secret";
  const replacement = "replacement-cli-secret";
  ctx.keychain.values.set("cli-setup-user:forklight.minimax.api-key", previous);
  const failingSettings = {
    get: () => ctx.settings.get(),
    update: () => { throw new Error("db failed"); },
  };
  try {
    await assert.rejects(
      () => runSetupCommand(
        ["provider", "select", "--provider", "minimax", "--variant", "china", "--confirm"],
        ctx.deps({
          settings: failingSettings,
          stdin: Readable.from([replacement]),
        }),
      ),
      (error: unknown) => error instanceof Error
        && /previous Keychain state was restored/.test(error.message)
        && !error.message.includes(previous)
        && !error.message.includes(replacement),
    );
    assert.equal(ctx.keychain.values.get("cli-setup-user:forklight.minimax.api-key"), previous);
  } finally {
    ctx.close();
  }
});

test("built-in Worker list includes grok-4-6-xhigh and invalid ids do not mutate", async () => {
  const ctx = await isolated();
  try {
    const listed = await runSetupCommand(["worker", "list"], ctx.deps());
    assert.match(listed.stdout, /grok-4-6-xhigh/);
    const selected = await runSetupCommand(
      ["worker", "select", "--profile", "grok-4-6-xhigh"],
      ctx.deps(),
    );
    assert.match(selected.stdout, /Grok 4.6 Xhigh/);
    assert.equal(ctx.settings.get().workerProfiles.defaultProfileId, "grok-4-6-xhigh");
    await assert.rejects(
      () => runSetupCommand(["worker", "select", "--profile", "missing-profile"], ctx.deps()),
      /not in the current settings/,
    );
    assert.equal(ctx.settings.get().workerProfiles.defaultProfileId, "grok-4-6-xhigh");
  } finally {
    ctx.close();
  }
});

test("Main install status and uninstall use a temp home, backup, and new-session guidance", async () => {
  const ctx = await isolated();
  try {
    const targetDir = path.join(ctx.mainHome, ".grok");
    await mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, "config.toml");
    await writeFile(targetPath, 'model = "grok"\n', "utf8");

    const missing = await runSetupCommand(
      ["main", "install", "--client", "grok-build", "--component", "mcp"],
      ctx.deps(),
    ).catch((error: unknown) => error);
    assert.ok(missing instanceof Error);
    assert.match((missing as Error).message, /--confirm/);
    assert.equal(await readFile(targetPath, "utf8"), 'model = "grok"\n');

    const installed = await runSetupCommand(
      ["main", "install", "--client", "grok-build", "--component", "mcp", "--confirm", "--json"],
      ctx.deps(),
    );
    const body = JSON.parse(installed.stdout) as {
      newSessionNeeded: boolean;
      backupPath?: string;
      fact: string;
      next: string;
    };
    assert.equal(body.newSessionNeeded, true);
    assert.ok(body.backupPath);
    assert.match(body.next, /new Grok session/i);
    const afterInstall = await readFile(targetPath, "utf8");
    assert.match(afterInstall, /\[mcp_servers\.forklight\]/);
    assert.doesNotMatch(afterInstall, /sk-|api_key|ANTHROPIC_AUTH/i);

    const status = await runSetupCommand(
      ["main", "status", "--client", "grok-build", "--json"],
      ctx.deps(),
    );
    const statusBody = JSON.parse(status.stdout) as { mains: Array<{ client: string; mcp: boolean }> };
    assert.equal(statusBody.mains[0]?.mcp, true);

    const uninstalled = await runSetupCommand(
      ["main", "uninstall", "--client", "grok-build", "--component", "mcp", "--confirm"],
      ctx.deps(),
    );
    assert.match(uninstalled.stdout, /new Grok session/i);
    const afterUninstall = await readFile(targetPath, "utf8");
    assert.doesNotMatch(afterUninstall, /mcp_servers\.forklight/);
    assert.match(afterUninstall, /model = "grok"/);
  } finally {
    ctx.close();
  }
});

test("unsupported Main client is rejected before any file change", async () => {
  const ctx = await isolated();
  try {
    await assert.rejects(
      () => runSetupCommand(
        ["main", "install", "--client", "notepad", "--component", "mcp", "--confirm"],
        ctx.deps(),
      ),
      /Unsupported Main client/,
    );
  } finally {
    ctx.close();
  }
});

test("usage lists the implemented setup commands and no secret flags", async () => {
  assert.match(SETUP_USAGE, /setup status/);
  assert.match(SETUP_USAGE, /setup provider select/);
  assert.match(SETUP_USAGE, /setup worker list/);
  assert.match(SETUP_USAGE, /setup worker select/);
  assert.match(SETUP_USAGE, /setup main status/);
  assert.match(SETUP_USAGE, /setup main install/);
  assert.match(SETUP_USAGE, /setup main uninstall/);
  assert.doesNotMatch(SETUP_USAGE, /--api-key|--key /);
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      path.join(root, "src", "cli.ts"),
      "help",
    ],
    { cwd: root, timeout: 20_000 },
  );
  assert.match(stdout, /forklight setup status/);
  assert.match(stdout, /forklight setup provider select/);
  assert.match(stdout, /forklight setup worker select/);
  assert.match(stdout, /forklight setup main install/);
});

test("real CLI entry prints setup status instead of the removed Hub redirect", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cli-setup-spawn-"));
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      path.join(root, "src", "cli.ts"),
      "setup",
      "status",
    ],
    {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: 20_000,
    },
  );
  const text = `${stdout}${stderr}`;
  assert.match(text, /^fact: /m);
  assert.match(text, /^reason: /m);
  assert.match(text, /^next: /m);
  assert.doesNotMatch(text, /standalone setup UI was removed/i);
});

test("SetupService still owns the transactional API-key commit used by CLI", async () => {
  const ctx = await isolated();
  try {
    const service = new SetupService(ctx.settings, ctx.keychain, ctx.system);
    const secret = "service-owned-secret";
    const result = service.commitProvider({ provider: "deepseek", variant: "default" }, secret);
    assert.equal(result.stored, true);
    assert.equal(JSON.stringify(result).includes(secret), false);
  } finally {
    ctx.close();
  }
});
