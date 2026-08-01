/**
 * Doctor truth resolver: Choose trustworthy Provider readiness evidence and
 * produce one stable beginner-readable diagnosis.
 *
 * Pure decision logic: no credential access, Provider request, process
 * lifecycle, Task mutation, endpoint disclosure, or raw error propagation.
 */

import {
  compareBuildIdentity,
  isBuildIdentity,
  type BuildIdentity,
} from "../core/build-identity.js";
import {
  providerLabel,
  providerNames,
  type ProviderName,
  type ProviderReadiness,
} from "../core/providers.js";
import {
  SUPPORTED_RUNTIME_NAMES,
  type RuntimeName,
} from "../core/runtime-names.js";
import type { SetupPrerequisite } from "./types.js";

// ── Public result types ─────────────────────────────────────────────

/** Provenance tag that tells the user where readiness facts came from. */
export type DoctorSource = "daemon" | "local-fallback";

/** Per-Provider readiness fact, safe for human and JSON output.
 *  Never contains endpoint, keychain service, raw error, or credential. */
export interface DoctorProviderFact {
  name: ProviderName;
  label: string;
  /** Whether any usable authentication is present for this Provider. */
  configured: boolean;
  /** Whether the Worker can launch with this Provider right now. */
  ready: boolean;
  /** Bounded authentication mode; never contains credential material. */
  authMode: "api-key" | "local-sign-in" | "none";
  defaultModel: string;
}

/** The one selected current/default Provider. */
export interface DoctorCurrent {
  provider: ProviderName;
  providerLabel: string;
  model: string;
}

/** Stable next-action code with a human-friendly message. */
export interface DoctorNextAction {
  /** Machine-readable code for automation. */
  code: "none" | "configure-provider";
  /** Human-friendly one-sentence guidance in plain language. */
  message: string;
}

/** Canonical safe Doctor result that names its evidence source and next action. */
export interface DoctorResult {
  source: DoctorSource;
  /** Bounded human-readable reason when source is local-fallback. */
  sourceDetail: string;
  prerequisites: SetupPrerequisite[];
  providers: DoctorProviderFact[];
  current: DoctorCurrent | null;
  nextAction: DoctorNextAction;
}

// ── Input types ─────────────────────────────────────────────────────

/** Bounded evidence from one read-only daemon health exchange.
 *  Callers must never embed the raw response object. */
export interface DaemonHealthEvidence {
  ok: boolean;
  serverIdentity: unknown;
  result?: unknown;
}

/** Lightweight provider fact from local SetupService inspection. */
export interface LocalProviderFact {
  name: ProviderName;
  label: string;
  configured: boolean;
  ready: boolean;
  authMode: DoctorProviderFact["authMode"];
  defaultModel: string;
}

// ── Resolver input ──────────────────────────────────────────────────

export interface DoctorInput {
  prerequisites: SetupPrerequisite[];
  clientBuildIdentity: BuildIdentity;
  daemonEvidence?: DaemonHealthEvidence;
  /** Local provider facts from SetupService.describeProviders(). */
  localProviders: LocalProviderFact[];
  /** Effective default provider from settings. */
  effectiveDefaultProvider: ProviderName | undefined;
}

export interface ExecutionProviderFactsResult {
  source: DoctorSource;
  sourceDetail: string;
  providers: DoctorProviderFact[];
}

/** Resolve the one authentication/readiness authority used by the process that
 * actually launches Workers. An exact-build Daemon wins; otherwise the local
 * invoking process remains an explicitly labelled fallback. */
export function resolveExecutionProviderFacts(
  input: Pick<DoctorInput, "clientBuildIdentity" | "daemonEvidence" | "localProviders">,
): ExecutionProviderFactsResult {
  if (input.daemonEvidence !== undefined && input.daemonEvidence.ok) {
    const { serverIdentity } = input.daemonEvidence;
    if (isBuildIdentity(serverIdentity)) {
      const comparison = compareBuildIdentity(input.clientBuildIdentity, serverIdentity);
      if (comparison.sameBuild) {
        const daemonFacts = daemonProviderFacts(input.daemonEvidence.result);
        if (daemonFacts !== undefined) {
          return {
            source: "daemon",
            sourceDetail: "build-matched daemon",
            providers: daemonFacts,
          };
        }
        return localExecutionFacts(input.localProviders, "malformed daemon evidence");
      }
      return localExecutionFacts(
        input.localProviders,
        comparison.protocolCompatible ? "daemon build mismatch" : "daemon protocol mismatch",
      );
    }
    return localExecutionFacts(input.localProviders, "unreadable daemon identity");
  }
  return localExecutionFacts(input.localProviders, "daemon unavailable");
}

function localExecutionFacts(
  providers: readonly LocalProviderFact[],
  sourceDetail: string,
): ExecutionProviderFactsResult {
  return {
    source: "local-fallback",
    sourceDetail,
    providers: localProviderFacts(providers),
  };
}

/** Re-attach the non-secret Provider catalog metadata already owned by the
 * caller after execution-authority facts have been selected. */
export function projectExecutionProviderReadiness(
  facts: readonly DoctorProviderFact[],
  local: Record<ProviderName, ProviderReadiness>,
): { anyReady: boolean; providers: Record<ProviderName, ProviderReadiness> } {
  const providers = {} as Record<ProviderName, ProviderReadiness>;
  let anyReady = false;
  for (const fact of facts) {
    const metadata = local[fact.name];
    if (fact.ready) anyReady = true;
    providers[fact.name] = {
      ready: fact.ready,
      authMode: fact.authMode,
      endpoint: metadata.endpoint,
      defaultModel: fact.defaultModel,
      keychainService: metadata.keychainService,
      ...(fact.ready ? {} : { error: "Local authentication not found" }),
    };
  }
  return { anyReady, providers };
}

// ── Runtime authority ───────────────────────────────────────────────

/** Lightweight runtime fact from one local doctor() call. */
export interface LocalRuntimeFact {
  name: RuntimeName;
  ok: boolean;
}

/** Non-secret catalog metadata used only to enrich runtime presentation.
 *  Never contains credentials, endpoints, paths, or raw diagnostics. */
export interface RuntimeDisplayMetadata {
  displayName: string;
  executable: string;
  version?: string;
  issues?: string[];
  capabilities?: unknown;
}

/** The one selected runtime readiness authority for the process that
 *  actually launches Workers. */
export interface ExecutionRuntimeFactsResult {
  source: DoctorSource;
  sourceDetail: string;
  /** Allowlisted per-runtime ok flags from exactly one source. */
  runtimes: Partial<Record<RuntimeName, { ok: boolean }>>;
}

export interface ExecutionRuntimeFactsInput {
  clientBuildIdentity: BuildIdentity;
  daemonEvidence?: DaemonHealthEvidence;
  localRuntimes: readonly LocalRuntimeFact[];
}

/** Resolve the one runtime readiness authority used by the process that
 *  actually launches Workers. Mirrors resolveExecutionProviderFacts: an
 *  exact-build Daemon wins only as a complete allowlisted snapshot; otherwise
 *  the complete local snapshot wins with one bounded fallback reason. Daemon
 *  and local runtime booleans are never mixed within one result. Pure and
 *  read-only: no subprocess, Provider, credential, lifecycle, Task, or
 *  Settings mutation. */
export function resolveExecutionRuntimeFacts(
  input: ExecutionRuntimeFactsInput,
): ExecutionRuntimeFactsResult {
  if (input.daemonEvidence !== undefined && input.daemonEvidence.ok) {
    const { serverIdentity } = input.daemonEvidence;
    if (isBuildIdentity(serverIdentity)) {
      const comparison = compareBuildIdentity(input.clientBuildIdentity, serverIdentity);
      if (comparison.sameBuild) {
        const daemonRuntimes = daemonRuntimeFacts(input.daemonEvidence.result);
        if (daemonRuntimes !== undefined) {
          return {
            source: "daemon",
            sourceDetail: "build-matched daemon",
            runtimes: daemonRuntimes,
          };
        }
        return localRuntimeFacts(input.localRuntimes, "malformed daemon evidence");
      }
      return localRuntimeFacts(
        input.localRuntimes,
        comparison.protocolCompatible ? "daemon build mismatch" : "daemon protocol mismatch",
      );
    }
    return localRuntimeFacts(input.localRuntimes, "unreadable daemon identity");
  }
  return localRuntimeFacts(input.localRuntimes, "daemon unavailable");
}

function daemonRuntimeFacts(
  result: unknown,
): Partial<Record<RuntimeName, { ok: boolean }>> | undefined {
  if (result === null || typeof result !== "object") return undefined;
  const obj = result as Record<string, unknown>;
  const runtimes = obj.runtimes;
  if (runtimes === null || typeof runtimes !== "object" || Array.isArray(runtimes)) {
    return undefined;
  }
  const runtimeObject = runtimes as Record<string, unknown>;
  const facts: Partial<Record<RuntimeName, { ok: boolean }>> = {};
  for (const name of SUPPORTED_RUNTIME_NAMES) {
    const value = runtimeObject[name];
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entry = value as Record<string, unknown>;
    if (typeof entry.ok !== "boolean") return undefined;
    facts[name] = { ok: entry.ok };
  }
  return facts;
}

function localRuntimeFacts(
  locals: readonly LocalRuntimeFact[],
  sourceDetail: string,
): ExecutionRuntimeFactsResult {
  const runtimes: Partial<Record<RuntimeName, { ok: boolean }>> = {};
  for (const local of locals) {
    runtimes[local.name] = { ok: local.ok };
  }
  return { source: "local-fallback", sourceDetail, runtimes };
}

/** Project the selected runtime facts into a bounded display record. The ok
 *  flag always comes from the selected source. Local catalog metadata
 *  (displayName/executable/capabilities) is non-secret and PATH-independent,
 *  but local version/issues are surfaced only for a local-fallback source
 *  because they describe the caller shell PATH, not the execution Daemon. */
export function projectExecutionRuntimeDisplay(
  facts: ExecutionRuntimeFactsResult,
  local: Partial<Record<RuntimeName, RuntimeDisplayMetadata>>,
): Record<string, {
  ok: boolean;
  displayName?: string;
  executable?: string;
  version?: string;
  issues?: string[];
  capabilities?: unknown;
}> {
  const display: Record<string, {
    ok: boolean;
    displayName?: string;
    executable?: string;
    version?: string;
    issues?: string[];
    capabilities?: unknown;
  }> = {};
  for (const name of SUPPORTED_RUNTIME_NAMES) {
    const fact = facts.runtimes[name];
    if (fact === undefined) continue;
    const metadata = local[name];
    const entry: {
      ok: boolean;
      displayName?: string;
      executable?: string;
      version?: string;
      issues?: string[];
      capabilities?: unknown;
    } = { ok: fact.ok };
    if (metadata !== undefined) {
      entry.displayName = metadata.displayName;
      entry.executable = metadata.executable;
      if (metadata.capabilities !== undefined) entry.capabilities = metadata.capabilities;
      if (facts.source === "local-fallback") {
        if (metadata.version !== undefined) entry.version = metadata.version;
        if (metadata.issues !== undefined) entry.issues = metadata.issues;
      }
    }
    display[name] = entry;
  }
  return display;
}

/** Bounded CLI health header: the single `ok` flag and the `claudeCode`
 *  string shown at the top of `forklight health`. */
export interface ExecutionClaudeOk {
  ok: boolean;
  claudeCode: string;
}

/** Local caller facts used only for an explicitly labelled fallback. */
export interface LocalClaudeOkInput {
  ok: boolean;
  claudeCode: string;
}

/** Project the CLI health header from the same runtime authority. When an
 *  exact-build Daemon is authoritative, claudeCode comes from the bounded
 *  Daemon health payload (never the caller shell PATH) and ok stays consistent
 *  with the effective Provider readiness; otherwise the local caller snapshot
 *  wins as a whole. Pure and read-only. */
export function projectExecutionClaudeOk(
  runtimeFacts: ExecutionRuntimeFactsResult,
  daemonEvidence: DaemonHealthEvidence | undefined,
  readinessAnyReady: boolean,
  local: LocalClaudeOkInput,
): ExecutionClaudeOk {
  if (runtimeFacts.source === "daemon") {
    const claudeCode = daemonClaudeCode(daemonEvidence?.result);
    return {
      claudeCode,
      ok: claudeCode !== "unavailable" && readinessAnyReady,
    };
  }
  return { claudeCode: local.claudeCode, ok: local.ok };
}

function daemonClaudeCode(result: unknown): string {
  if (result === null || typeof result !== "object") return "unavailable";
  const obj = result as Record<string, unknown>;
  return typeof obj.claudeCode === "string" && obj.claudeCode.length > 0
    ? obj.claudeCode
    : "unavailable";
}

// ── Resolver ────────────────────────────────────────────────────────

/** Produce one canonical safe Doctor result from all available evidence.
 *  Pure: no credential access, Provider request, lifecycle mutation,
 *  endpoint/keychain/raw-error disclosure. */
export function resolveDoctorResult(input: DoctorInput): DoctorResult {
  const execution = resolveExecutionProviderFacts(input);
  const { source, sourceDetail, providers: providerFacts } = execution;

  const current = selectCurrentProvider(
    providerFacts,
    input.effectiveDefaultProvider,
  );

  const nextAction: DoctorNextAction =
    current !== null
      ? { code: "none", message: "Ready to execute" }
      : { code: "configure-provider", message: "Configure a Provider to get started" };

  return {
    source,
    sourceDetail,
    prerequisites: input.prerequisites,
    providers: providerFacts,
    current,
    nextAction,
  };
}

// ── Daemon evidence extraction ──────────────────────────────────────

function daemonProviderFacts(
  result: unknown,
): DoctorProviderFact[] | undefined {
  if (result === null || typeof result !== "object") return undefined;
  const obj = result as Record<string, unknown>;
  const providers = obj.providers;
  if (providers === null || typeof providers !== "object" || Array.isArray(providers)) {
    return undefined;
  }
  const providerObject = providers as Record<string, unknown>;
  const facts: DoctorProviderFact[] = [];
  for (const name of providerNames()) {
    const value = providerObject[name];
    if (value === null || typeof value !== "object") continue;
    const p = value as Record<string, unknown>;
    if (typeof p.ready !== "boolean") return undefined;
    const ready = p.ready;
    const rawAuth = p.authMode;
    if (rawAuth !== "api-key" && rawAuth !== "local-sign-in" && rawAuth !== "none") {
      return undefined;
    }
    const authMode = rawAuth;
    const configured = authMode !== "none";
    if (ready !== configured) return undefined;
    const defaultModel =
      typeof p.defaultModel === "string" && p.defaultModel.length > 0
        ? p.defaultModel
        : undefined;
    if (defaultModel === undefined) return undefined;
    facts.push({
      name,
      label: providerLabel(name),
      configured,
      ready,
      authMode,
      defaultModel,
    });
  }
  return facts.length === providerNames().length ? facts : undefined;
}

// ── Local fallback facts ────────────────────────────────────────────

function localProviderFacts(
  locals: readonly LocalProviderFact[],
): DoctorProviderFact[] {
  return locals.map((l) => ({
    name: l.name,
    label: l.label,
    configured: l.configured,
    ready: l.ready,
    authMode: l.authMode,
    defaultModel: l.defaultModel,
  }));
}

// ── Current provider selection ──────────────────────────────────────

function selectCurrentProvider(
  providers: readonly DoctorProviderFact[],
  effectiveDefault: ProviderName | undefined,
): DoctorCurrent | null {
  // Prefer the effective configured default when it is ready.
  if (effectiveDefault !== undefined) {
    const preferred = providers.find(
      (p) => p.name === effectiveDefault && p.ready,
    );
    if (preferred !== undefined) {
      return {
        provider: preferred.name,
        providerLabel: preferred.label,
        model: preferred.defaultModel,
      };
    }
  }
  // Otherwise the first ready Provider.
  const first = providers.find((p) => p.ready);
  if (first !== undefined) {
    return {
      provider: first.name,
      providerLabel: first.label,
      model: first.defaultModel,
    };
  }
  return null;
}

// ── Presentation ────────────────────────────────────────────────────

/** Render the canonical safe Doctor result as a short human diagnosis.
 *  Never contains credentials, keychain service, raw error, endpoint,
 *  token, nonce, command, stack, private path, or raw build id. */
export function renderDoctorHuman(result: DoctorResult): string {
  const lines: string[] = [];

  lines.push(`Source: ${result.source} (${result.sourceDetail})`);
  lines.push("Prerequisites:");
  for (const check of result.prerequisites) {
    lines.push(
      `  ${check.ready ? "✓" : "✗"} ${check.label}: ${check.message}`,
    );
    if (check.fix !== undefined) lines.push(`    fix: ${check.fix}`);
  }
  lines.push("Providers:");
  for (const p of result.providers) {
    lines.push(
      `  ${p.name} (${p.label}): ready=${p.ready} auth=${p.authMode} model=${p.defaultModel}`,
    );
  }
  if (result.current !== null) {
    lines.push(
      `Current default: ${result.current.providerLabel} model=${result.current.model}`,
    );
  } else {
    lines.push("No provider is ready.");
  }
  lines.push(`Next action: ${result.nextAction.message}`);

  return `${lines.join("\n")}\n`;
}

/** Serialize the canonical safe Doctor result as stable safe JSON.
 *  Never contains credentials, keychain service, raw error, endpoint,
 *  token, nonce, command, stack, private path, or raw build id. */
export function renderDoctorJson(result: DoctorResult): string {
  const safe: Record<string, unknown> = {
    source: result.source,
    sourceDetail: result.sourceDetail,
    prerequisites: result.prerequisites.map((p) => ({
      id: p.id,
      label: p.label,
      ready: p.ready,
      blocker: p.blocker,
      message: p.message,
      ...(p.fix === undefined ? {} : { fix: p.fix }),
    })),
    providers: result.providers.map((p) => ({
      name: p.name,
      label: p.label,
      configured: p.configured,
      ready: p.ready,
      authMode: p.authMode,
      defaultModel: p.defaultModel,
    })),
    current:
      result.current === null
        ? null
        : {
            provider: result.current.provider,
            providerLabel: result.current.providerLabel,
            model: result.current.model,
          },
    nextAction: {
      code: result.nextAction.code,
      message: result.nextAction.message,
    },
  };
  return `${JSON.stringify(safe, null, 2)}\n`;
}
