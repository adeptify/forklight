/**
 * Single source of truth for Worker runtime ids.
 * Parse/settings/MCP import this module only — never workers/registry.
 */

export const SUPPORTED_RUNTIME_NAMES = ["claude-code", "grok-build", "codex-cli"] as const;

export type RuntimeName = (typeof SUPPORTED_RUNTIME_NAMES)[number];

export function isRuntimeName(value: string): value is RuntimeName {
  return (SUPPORTED_RUNTIME_NAMES as readonly string[]).includes(value);
}

export function supportedRuntimeNamesList(): string {
  return SUPPORTED_RUNTIME_NAMES.join(", ");
}

export function defaultExecutableForRuntime(runtimeName: RuntimeName): string {
  switch (runtimeName) {
    case "claude-code": return "claude";
    case "grok-build": return "grok";
    case "codex-cli": return "codex";
  }
}

/**
 * Fail-closed provider × worker-runtime pairing.
 * Local runtimes have exclusive provider pairings where their authentication
 * and wire protocol are runtime-owned rather than Anthropic-compatible.
 */
export function assertProviderRuntimePair(providerName: string, runtimeName: string): void {
  if (runtimeName === "grok-build") {
    if (providerName !== "xai") {
      throw new Error(
        `runtime.name=grok-build requires provider.name=xai (received ${providerName})`,
      );
    }
    return;
  }
  if (runtimeName === "codex-cli") {
    if (providerName !== "openai") {
      throw new Error(
        `runtime.name=codex-cli requires provider.name=openai (received ${providerName})`,
      );
    }
    return;
  }
  if (providerName === "openai") {
    throw new Error(
      `provider.name=openai requires runtime.name=codex-cli (received ${runtimeName})`,
    );
  }
  if (runtimeName === "claude-code" && providerName === "xai") {
    throw new Error(
      `runtime.name=claude-code does not support provider.name=xai`,
    );
  }
}
