import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsService } from "../src/core/settings.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { StateStore } from "../src/state/store.js";

class MemoryKeychain implements SetupKeychainStore {
  readonly values = new Map<string, string>();
  reads = 0;
  failWrite = false;
  failDelete = false;

  private id(service: string, account: string): string { return `${account}:${service}`; }
  has(service: string, account: string): boolean { return this.values.has(this.id(service, account)); }
  read(service: string, account: string): string | undefined {
    this.reads += 1;
    return this.values.get(this.id(service, account));
  }
  write(service: string, account: string, value: string): void {
    if (this.failWrite) throw new Error(`write failed ${value}`);
    this.values.set(this.id(service, account), value);
  }
  delete(service: string, account: string): void {
    if (this.failDelete) throw new Error("delete failed");
    this.values.delete(this.id(service, account));
  }
}

function inspector(overrides: Partial<SetupSystemInspector> = {}): SetupSystemInspector {
  return {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "setup-test-user",
    commandExists: () => true,
    ...overrides,
  };
}

async function fixture(system = inspector()) {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-setup-"));
  const settings = new SettingsService(new StateStore(home));
  const keychain = new MemoryKeychain();
  return { settings, keychain, service: new SetupService(settings, keychain, system) };
}

test("setup bootstrap is read-only, actionable, and exposes plan-aware provider choices", async () => {
  const { service, keychain } = await fixture();
  const first = service.bootstrap();
  const second = service.bootstrap();
  assert.deepEqual(second, first);
  assert.equal(first.prerequisites.every((item) => item.ready && !item.blocker), true);
  assert.deepEqual(first.providers.map((item) => item.name), ["deepseek", "qwen", "minimax", "glm", "volcengine", "xai"]);
  assert.equal(first.providers.find((item) => item.name === "qwen")?.variants[0]?.id, "token-plan");
  assert.equal(first.providers.find((item) => item.name === "minimax")?.variants.length, 2);
  assert.equal(keychain.reads, 0, "discovery may check presence but must never read key values");
});

test("setup prerequisites report blockers with fixes", async () => {
  const { service } = await fixture(inspector({
    platform: () => "linux",
    nodeVersion: () => "v22.0.0",
    commandExists: (command) => command === "claude",
  }));
  const checks = service.inspectPrerequisites();
  assert.deepEqual(checks.filter((item) => item.blocker).map((item) => item.id), ["platform", "node", "codex", "keychain"]);
  assert.equal(checks.filter((item) => item.blocker).every((item) => Boolean(item.fix)), true);
});

test("setup resolves Alibaba Token Plan and MiniMax China without guessing endpoints", async () => {
  const { service } = await fixture();
  const qwen = service.resolveProvider({ provider: "qwen", variant: "token-plan", model: "qwen3.8-max-preview" });
  assert.equal(qwen.endpoint, "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic");
  assert.equal(qwen.model, "qwen3.8-max-preview");
  const minimax = service.resolveProvider({ provider: "minimax", variant: "china", model: "MiniMax-M3[1m]" });
  assert.equal(minimax.endpoint, "https://api.minimaxi.com/anthropic");
  assert.equal(minimax.model, "MiniMax-M3[1m]");
});

test("setup rejects unknown variants and unsafe custom endpoints before Keychain access", async () => {
  const { service, keychain } = await fixture();
  assert.throws(() => service.resolveProvider({ provider: "minimax", variant: "moon" }), /valid provider plan/);
  assert.throws(
    () => service.resolveProvider({ provider: "qwen", variant: "token-plan", endpoint: "http://example.com" }),
    /HTTPS URL/,
  );
  assert.equal(keychain.values.size, 0);
  assert.equal(keychain.reads, 0);
});

test("provider commit stores only the key in Keychain and writes safe settings", async () => {
  const { service, settings, keychain } = await fixture();
  const secret = "setup-secret-that-must-not-leak";
  const result = service.commitProvider(
    { provider: "minimax", variant: "china", model: "MiniMax-M3" },
    secret,
  );
  assert.equal(keychain.values.get("setup-test-user:forklight.minimax.api-key"), secret);
  assert.equal(settings.get().execution.defaultProvider, "minimax");
  assert.equal(settings.get().providerDefaults.minimax.defaultEndpoint, "https://api.minimaxi.com/anthropic");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(settings.get()).includes(secret), false);
});

test("Keychain write failure leaves settings unchanged and redacts provider output", async () => {
  const { service, settings, keychain } = await fixture();
  const before = settings.get();
  keychain.failWrite = true;
  const secret = "failed-write-secret";
  assert.throws(
    () => service.commitProvider({ provider: "minimax", variant: "china" }, secret),
    (error: unknown) => error instanceof Error && !error.message.includes(secret),
  );
  assert.deepEqual(settings.get(), before);
});

test("settings failure restores the previous Keychain value", async () => {
  const { settings, keychain } = await fixture();
  keychain.values.set("setup-test-user:forklight.minimax.api-key", "previous-secret");
  const failingSettings = { get: () => settings.get(), update: () => { throw new Error("db failed"); } };
  const service = new SetupService(failingSettings, keychain, inspector());
  assert.throws(
    () => service.commitProvider({ provider: "minimax", variant: "china" }, "replacement-secret"),
    /previous Keychain state was restored/,
  );
  assert.equal(keychain.values.get("setup-test-user:forklight.minimax.api-key"), "previous-secret");
});

test("an unreadable existing Keychain entry fails closed before overwrite", async () => {
  const { settings, keychain } = await fixture();
  keychain.values.set("setup-test-user:forklight.minimax.api-key", "");
  const unreadable = Object.create(keychain) as MemoryKeychain;
  unreadable.read = () => undefined;
  const service = new SetupService(settings, unreadable, inspector());
  assert.throws(
    () => service.commitProvider({ provider: "minimax", variant: "china" }, "new-valid-secret"),
    /could not be backed up/,
  );
  assert.equal(keychain.values.get("setup-test-user:forklight.minimax.api-key"), "");
});

test("credential commit refuses unsupported environments", async () => {
  const { settings, keychain } = await fixture();
  const service = new SetupService(settings, keychain, inspector({ platform: () => "linux" }));
  assert.throws(
    () => service.commitProvider({ provider: "deepseek", variant: "default" }, "valid-test-key"),
    /Keychain is not available/,
  );
  assert.equal(keychain.values.size, 0);
});
