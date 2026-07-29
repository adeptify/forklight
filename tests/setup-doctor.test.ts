import assert from "node:assert/strict";
import test from "node:test";
import type { BuildIdentity } from "../src/core/build-identity.js";
import { PROTOCOL_VERSION } from "../src/core/build-identity.js";
import {
  resolveDoctorResult,
  renderDoctorHuman,
  renderDoctorJson,
  projectExecutionProviderReadiness,
  type DaemonHealthEvidence,
  type DoctorInput,
  type DoctorResult,
  type LocalProviderFact,
} from "../src/setup/doctor.js";
import type { SetupPrerequisite } from "../src/setup/types.js";
import type { ProviderName, ProviderReadiness } from "../src/core/providers.js";

// ── Helpers ─────────────────────────────────────────────────────────

function prerequisites(allReady = true): SetupPrerequisite[] {
  return [
    { id: "platform", label: "macOS", ready: true, blocker: false, message: "Supported" },
    { id: "node", label: "Node.js 24+", ready: allReady, blocker: !allReady, message: `Detected ${allReady ? "v24.5.0" : "v22.0.0"}`, ...(allReady ? {} : { fix: "Install Node.js 24 or newer" }) },
    { id: "claude", label: "Claude Code", ready: allReady, blocker: !allReady, message: allReady ? "Available" : "Not found", ...(allReady ? {} : { fix: "Install Claude Code" }) },
    { id: "codex", label: "Codex CLI", ready: allReady, blocker: !allReady, message: allReady ? "Available" : "Not found", ...(allReady ? {} : { fix: "Install Codex CLI" }) },
    { id: "keychain", label: "macOS Keychain", ready: allReady, blocker: !allReady, message: allReady ? "Available" : "Not found", ...(allReady ? {} : { fix: "macOS Keychain unavailable" }) },
  ];
}

function localProviders(configured: string[] = []): LocalProviderFact[] {
  const names: Array<{ name: LocalProviderFact["name"]; label: string; defaultModel: string }> = [
    { name: "deepseek", label: "DeepSeek", defaultModel: "deepseek-v4-pro[1m]" },
    { name: "qwen", label: "Qwen via Alibaba Model Studio", defaultModel: "qwen3.8-max-preview" },
    { name: "minimax", label: "MiniMax", defaultModel: "MiniMax-M3" },
    { name: "glm", label: "GLM via Alibaba Model Studio", defaultModel: "glm-5.2" },
    { name: "volcengine", label: "Volcengine Coding Plan (GLM)", defaultModel: "glm-5.2[1M]" },
    { name: "xai", label: "xAI", defaultModel: "grok-code[1M]" },
  ];
  return names.map((n) => ({
    name: n.name,
    label: n.label,
    configured: configured.includes(n.name),
    ready: configured.includes(n.name),
    authMode: configured.includes(n.name) ? ("api-key" as const) : ("none" as const),
    defaultModel: n.defaultModel,
  }));
}

function buildIdentity(overrides: Partial<BuildIdentity> = {}): BuildIdentity {
  return {
    protocolVersion: PROTOCOL_VERSION, packageVersion: "0.2.0",
    buildId: "dev-6a5f2b381d90a3b8a0f0e5e2f4a6c8d0", builtAt: "2026-07-28T00:00:00.000Z",
    sourceRevision: "dev-source", sourceDigest: "6a5f2b381d90a3b8a0f0e5e2f4a6c8d06a5f2b381d90a3b8a0f0e5e2f4a6c8d0",
    ...overrides,
  };
}

function daemonHealthProviders(readyList: string[]): Record<string, unknown> {
  const mk = (name: string, authMode: string) => ({
    ready: readyList.includes(name), authMode: readyList.includes(name) ? authMode : "none",
    endpoint: "https://private.example.com/anthropic", defaultModel: `${name}-model`,
    keychainService: `forklight.${name}.api-key`,
  });
  return {
    deepseek: mk("deepseek", "api-key"), qwen: mk("qwen", "api-key"),
    minimax: mk("minimax", "api-key"), glm: mk("glm", "api-key"),
    volcengine: mk("volcengine", "api-key"), xai: mk("xai", "local-sign-in"),
  };
}

function daemonEvidence(readyList: string[] = [], overrides: Partial<DaemonHealthEvidence> = {}): DaemonHealthEvidence {
  return {
    ok: overrides.ok ?? true,
    serverIdentity: overrides.serverIdentity ?? buildIdentity(),
    result: overrides.result ?? { ok: true, providers: daemonHealthProviders(readyList) },
  };
}

function resolve(opts: {
  daemonReady?: string[]; daemonEvidence?: DaemonHealthEvidence;
  localConfigured?: string[]; defaultProvider?: ProviderName; prereqReady?: boolean;
} = {}): DoctorResult {
  const selectedDaemonEvidence = opts.daemonEvidence
    ?? (opts.daemonReady !== undefined ? daemonEvidence(opts.daemonReady) : undefined);
  return resolveDoctorResult({
    prerequisites: prerequisites(opts.prereqReady ?? true),
    clientBuildIdentity: buildIdentity(),
    ...(selectedDaemonEvidence === undefined ? {} : { daemonEvidence: selectedDaemonEvidence }),
    localProviders: localProviders(opts.localConfigured ?? []),
    effectiveDefaultProvider: opts.defaultProvider ?? "deepseek",
  });
}

// ── Source selection ────────────────────────────────────────────────

test("exact-build Daemon Provider readiness preferred over local inspection", () => {
  const r = resolve({ daemonReady: ["deepseek", "minimax", "volcengine", "xai"] });
  assert.equal(r.source, "daemon");
  assert.equal(r.sourceDetail, "build-matched daemon");
  assert.equal(r.providers.find((p) => p.name === "deepseek")!.ready, true);
  assert.equal(r.providers.find((p) => p.name === "minimax")!.authMode, "api-key");
});

test("Daemon readiness never mixed with contradictory local Keychain booleans", () => {
  const r = resolve({ daemonReady: ["deepseek"], localConfigured: [] });
  assert.equal(r.source, "daemon");
  const ds = r.providers.find((p) => p.name === "deepseek")!;
  assert.equal(ds.ready, true);
  assert.equal(ds.configured, true);
});

test("absent Daemon falls back to local without starting one", () => {
  const r = resolve({ localConfigured: ["deepseek"] });
  assert.equal(r.source, "local-fallback");
  assert.equal(r.sourceDetail, "daemon unavailable");
  assert.equal(r.providers.find((p) => p.name === "deepseek")!.ready, true);
  assert.equal(r.providers.find((p) => p.name === "qwen")!.ready, false);
});

test("build/protocol mismatch falls back to local with bounded reason", () => {
  const buildMismatch = resolve({ daemonEvidence: daemonEvidence(["deepseek"], { serverIdentity: buildIdentity({ buildId: "other" }) }), localConfigured: ["minimax"] });
  assert.equal(buildMismatch.source, "local-fallback");
  assert.equal(buildMismatch.sourceDetail, "daemon build mismatch");
  assert.equal(buildMismatch.providers.find((p) => p.name === "minimax")!.ready, true);

  const protoMismatch = resolve({ daemonEvidence: daemonEvidence(["deepseek"], { serverIdentity: buildIdentity({ protocolVersion: 999 }) }) });
  assert.equal(protoMismatch.sourceDetail, "daemon protocol mismatch");
});

test("malformed or absent daemon identity falls back to local", () => {
  const badId = resolve({ daemonEvidence: daemonEvidence([], { serverIdentity: {} }) });
  assert.equal(badId.sourceDetail, "unreadable daemon identity");
  const notOk = resolve({ daemonEvidence: daemonEvidence([], { ok: false }) });
  assert.equal(notOk.sourceDetail, "daemon unavailable");
});

test("malformed daemon evidence (missing/empty/invalid providers) falls back to local", () => {
  const noProv = resolve({ daemonEvidence: daemonEvidence([], { result: {} }) });
  assert.equal(noProv.sourceDetail, "malformed daemon evidence");
  const emptyProv = resolve({ daemonEvidence: daemonEvidence([], { result: { ok: true, providers: {} } }) });
  assert.equal(emptyProv.sourceDetail, "malformed daemon evidence");
  const badProv = resolve({ daemonEvidence: daemonEvidence([], { result: { ok: true, providers: "x" } }) });
  assert.equal(badProv.sourceDetail, "malformed daemon evidence");
});

// ── Default provider selection ──────────────────────────────────────

test("effective configured default selected when ready; otherwise first ready", () => {
  const r = resolve({ daemonReady: ["deepseek", "minimax"], defaultProvider: "minimax" });
  assert.equal(r.current?.provider, "minimax");

  const r2 = resolve({ daemonReady: ["minimax", "xai"], defaultProvider: "deepseek" });
  assert.equal(r2.current?.provider, "minimax");

  const r3 = resolve({ localConfigured: ["minimax", "xai"], defaultProvider: "deepseek" });
  assert.equal(r3.current?.provider, "minimax");
});

test("no ready Provider sets current null with configure-provider action", () => {
  const r = resolve({ daemonReady: [] });
  assert.equal(r.current, null);
  assert.equal(r.nextAction.code, "configure-provider");
  assert.equal(r.nextAction.message, "Configure a Provider to get started");

  const r2 = resolve({ localConfigured: [] });
  assert.equal(r2.current, null);
  assert.equal(r2.nextAction.code, "configure-provider");
});

test("next action is none when a ready Provider exists", () => {
  const r = resolve({ daemonReady: ["deepseek"] });
  assert.equal(r.nextAction.code, "none");
});

// ── Read-only / purity ──────────────────────────────────────────────

test("resolver is pure and never mutates its input", () => {
  const input: DoctorInput = {
    prerequisites: prerequisites(), clientBuildIdentity: buildIdentity(),
    daemonEvidence: daemonEvidence(["deepseek"]), localProviders: localProviders(["minimax"]),
    effectiveDefaultProvider: "deepseek",
  };
  const frozen = structuredClone(input);
  const first = resolveDoctorResult(input);
  const second = resolveDoctorResult(input);
  assert.deepEqual(second, first);
  assert.deepEqual(input, frozen);
});

// ── Provider auth modes ─────────────────────────────────────────────

test("daemon auth modes map correctly including xai local-sign-in", () => {
  const r = resolve({ daemonReady: ["xai"] });
  const xai = r.providers.find((p) => p.name === "xai")!;
  assert.equal(xai.authMode, "local-sign-in");
  assert.equal(xai.configured, true);

  const nope = resolve({ daemonReady: [] }).providers.find((p) => p.name === "qwen")!;
  assert.equal(nope.authMode, "none");
  assert.equal(nope.configured, false);

  const local = resolve({ localConfigured: ["deepseek"] }).providers.find((p) => p.name === "deepseek")!;
  assert.equal(local.authMode, "api-key");
});

test("malformed daemon authMode rejects the daemon snapshot and falls back locally", () => {
  const ev = daemonEvidence(["deepseek"]);
  const provs = (ev.result as Record<string, unknown>).providers as Record<string, unknown>;
  provs.deepseek = { ready: true, authMode: "garbage", defaultModel: "m" };
  const r = resolve({ daemonEvidence: ev });
  const ds = r.providers.find((p) => p.name === "deepseek")!;
  assert.equal(r.source, "local-fallback");
  assert.equal(r.sourceDetail, "malformed daemon evidence");
  assert.equal(ds.authMode, "none");
  assert.equal(ds.configured, false);
  assert.equal(ds.ready, false);
});

test("execution facts project daemon launch truth without mixing local booleans", () => {
  const local = Object.fromEntries(localProviders([]).map((provider) => [provider.name, {
    ready: false,
    authMode: "none" as const,
    endpoint: `https://${provider.name}.example.com`,
    defaultModel: provider.defaultModel,
    keychainService: `forklight.${provider.name}.api-key`,
    error: "Local authentication not found",
  }])) as Record<ProviderName, ProviderReadiness>;
  const facts = resolve({ daemonReady: ["deepseek", "minimax", "volcengine", "xai"] });
  const projected = projectExecutionProviderReadiness(facts.providers, local);
  assert.equal(projected.anyReady, true);
  assert.equal(projected.providers.deepseek.ready, true);
  assert.equal(projected.providers.deepseek.authMode, "api-key");
  assert.equal(projected.providers.deepseek.error, undefined);
  assert.equal(projected.providers.qwen.ready, false);
});

// ── Privacy-safe serialization ──────────────────────────────────────

const FORBIDDEN = ["keychainservice", "auth.json", "/Users/", "token", "secret", "stack", "anthropic_", "buildid", "sourcedigest", "sourcerevision", "command", "builtat", "packageversion", "endpoint", "https://"];

function assertNoForbidden(output: string, label: string): void {
  for (const tok of FORBIDDEN) {
    assert.equal(output.toLowerCase().includes(tok), false, `${label}: "${tok}" leaked`);
  }
}

test("JSON output never exposes credentials, endpoints, or diagnostic fields", () => {
  assertNoForbidden(renderDoctorJson(resolve({ daemonReady: ["deepseek", "xai"] })), "daemon-json");
  assertNoForbidden(renderDoctorJson(resolve({ localConfigured: ["minimax"] })), "local-json");
});

test("human output never exposes credentials, endpoints, or diagnostic fields", () => {
  assertNoForbidden(renderDoctorHuman(resolve({ daemonReady: ["deepseek", "xai"] })), "daemon-human");
  assertNoForbidden(renderDoctorHuman(resolve({ localConfigured: ["deepseek"] })), "local-human");
  const noReadyHuman = renderDoctorHuman(resolve({ daemonReady: [] }));
  assert.match(noReadyHuman, /No provider is ready/);
  assertNoForbidden(noReadyHuman, "no-ready-human");
});

// ── Output structure ────────────────────────────────────────────────

test("JSON output has expected structure", () => {
  const parsed = JSON.parse(renderDoctorJson(resolve({ daemonReady: ["deepseek"] }))) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["current", "nextAction", "prerequisites", "providers", "source", "sourceDetail"]);
  assert.equal(parsed.source, "daemon");
  assert.equal((parsed.providers as unknown[]).length, 6);

  const noReadyParsed = JSON.parse(renderDoctorJson(resolve({ daemonReady: [] }))) as Record<string, unknown>;
  assert.equal(noReadyParsed.current, null);

  const na = parsed.nextAction as Record<string, unknown>;
  assert.equal(na.code, "none");
  assert.equal(typeof na.message, "string");
});

test("human output shows source, providers, current, and next action", () => {
  const h = renderDoctorHuman(resolve({ daemonReady: ["deepseek"] }));
  assert.match(h, /^Source: daemon/);
  assert.match(h, /✓ macOS/);
  assert.match(h, /deepseek.*ready=true.*auth=api-key/);
  assert.match(h, /qwen.*ready=false.*auth=none/);
  assert.match(h, /Next action: Ready to execute/);

  const h2 = renderDoctorHuman(resolve({ daemonReady: ["minimax"], defaultProvider: "minimax" }));
  assert.match(h2, /Current default: MiniMax/);

  const h3 = renderDoctorHuman(resolve({ daemonReady: [] }));
  assert.match(h3, /Next action: Configure a Provider/);
});

test("human output contains no raw build identity artifacts", () => {
  const h = renderDoctorHuman(resolve({ daemonReady: ["deepseek"] }));
  for (const tok of ["buildId", "build-id", "serverIdentity", "protocolVersion", "sourceDigest"]) {
    assert.equal(h.includes(tok), false, tok);
  }
});

test("JSON output includes prerequisites with optional fix fields", () => {
  const r = resolve({ daemonReady: [], prereqReady: false });
  const parsed = JSON.parse(renderDoctorJson(r)) as Record<string, unknown>;
  const prereqs = parsed.prerequisites as Array<Record<string, unknown>>;
  const nodeCheck = prereqs.find((p) => p.id === "node")!;
  assert.equal(nodeCheck.ready, false);
  assert.equal(typeof nodeCheck.fix, "string");
});
