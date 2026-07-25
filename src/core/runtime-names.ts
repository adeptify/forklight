/**
 * Single source of truth for Worker runtime ids.
 * Parse/settings/MCP import this module only — never workers/registry.
 */

export const SUPPORTED_RUNTIME_NAMES = ["claude-code", "grok-build"] as const;

export type RuntimeName = (typeof SUPPORTED_RUNTIME_NAMES)[number];

export function isRuntimeName(value: string): value is RuntimeName {
  return (SUPPORTED_RUNTIME_NAMES as readonly string[]).includes(value);
}

export function supportedRuntimeNamesList(): string {
  return SUPPORTED_RUNTIME_NAMES.join(", ");
}

/**
 * Fail-closed provider × worker-runtime pairing.
 * `grok-build` only pairs with `xai`; `claude-code` never pairs with `xai`.
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
  if (runtimeName === "claude-code" && providerName === "xai") {
    throw new Error(
      `runtime.name=claude-code does not support provider.name=xai`,
    );
  }
}
