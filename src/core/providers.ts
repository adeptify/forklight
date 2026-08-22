import { execFileSync } from "node:child_process";
import { accessSync, constants, lstatSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { localAccountName } from "./config.js";
import type { TaskSpec } from "./types.js";
import {
  cloneDefaults,
  type ProviderDefaultSettings,
  type ProviderDefaultsSettings,
} from "./settings.js";

export type ProviderName = "deepseek" | "qwen" | "minimax" | "glm" | "volcengine" | "xai" | "openai";

interface ProviderDefinition {
  name: ProviderName;
  defaultModel: string;
  defaultEndpoint: string;
  defaultKeychainService: string;
  defaultHaikuModel?: string;
}

export interface ResolvedProviderConfig {
  name: ProviderName;
  model: string;
  endpoint: string;
  keychainService: string;
  keychainAccount?: string;
  haikuModel: string;
  requestTimeoutMs: number;
}

export interface ProviderVariant {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  models: string[];
  recommended?: boolean;
}

const PROVIDER_NAMES: ProviderName[] = ["deepseek", "qwen", "minimax", "glm", "volcengine", "xai", "openai"];

export function isProviderName(value: string): value is ProviderName {
  return PROVIDER_NAMES.includes(value as ProviderName);
}

export function providerNames(): ProviderName[] {
  return [...PROVIDER_NAMES];
}

export function providerDefinition(
  name: ProviderName,
  defaults: ProviderDefaultsSettings = cloneDefaults().providerDefaults,
): ProviderDefinition {
  return { name, ...defaults[name] };
}

export function resolveProvider(
  name: string,
  params: {
    endpoint?: string;
    model?: string;
    keychainService?: string;
    keychainAccount?: string;
  } = {},
  providerDefaults?: ProviderDefaultSettings,
): ResolvedProviderConfig {
  if (!isProviderName(name)) {
    throw new Error(`Unsupported provider: ${name}. Supported providers: ${providerNames().join(", ")}`);
  }
  const definition = providerDefinition(name);
  return {
    name,
    model: params.model ?? providerDefaults?.defaultModel ?? definition.defaultModel,
    endpoint: params.endpoint ?? providerDefaults?.defaultEndpoint ?? definition.defaultEndpoint,
    keychainService: params.keychainService ?? providerDefaults?.defaultKeychainService ?? definition.defaultKeychainService,
    ...(params.keychainAccount === undefined ? {} : { keychainAccount: params.keychainAccount }),
    haikuModel: providerDefaults?.defaultHaikuModel ?? definition.defaultHaikuModel ?? params.model ?? definition.defaultModel,
    requestTimeoutMs: providerDefaults?.requestTimeoutMs ?? cloneDefaults().providerDefaults[name].requestTimeoutMs,
  };
}

export function providerEnvironment(
  config: ResolvedProviderConfig,
  apiKey: string,
  baseEnvironment: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  if (config.name === "xai" || config.name === "openai") {
    throw new Error(
      `providerEnvironment does not support ${config.name}; its Worker adapter owns authentication and environment`,
    );
  }
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    ANTHROPIC_BASE_URL: config.endpoint,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_MODEL: config.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: config.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: config.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: config.haikuModel,
    API_TIMEOUT_MS: String(config.requestTimeoutMs),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  // Claude Code gives ANTHROPIC_API_KEY precedence and sends it as x-api-key.
  // External Anthropic-compatible providers use AUTH_TOKEN/Bearer instead.
  delete environment.ANTHROPIC_API_KEY;
  return environment;
}

export function providerLabel(name: ProviderName): string {
  switch (name) {
    case "deepseek": return "DeepSeek";
    case "qwen": return "Qwen via Alibaba Model Studio";
    case "minimax": return "MiniMax";
    case "glm": return "GLM via Alibaba Model Studio";
    case "volcengine": return "Volcengine Coding Plan (GLM)";
    case "xai": return "xAI";
    case "openai": return "OpenAI (Codex local sign-in)";
  }
}

export function providerVariantLabel(name: ProviderName): string {
  if (name === "minimax") return "Account region";
  if (name === "qwen" || name === "glm") return "Alibaba plan";
  if (name === "volcengine") return "Coding Plan";
  return "Connection";
}

export function providerVariants(
  name: ProviderName,
  defaults: ProviderDefaultsSettings = cloneDefaults().providerDefaults,
): ProviderVariant[] {
  const current = providerDefinition(name, defaults);
  if (name === "openai") {
    return [{
      id: "local-codex",
      label: "Local Codex sign-in",
      description: "Uses the signed-in Codex CLI with runtime codex-cli; no API key is stored by ForkLight.",
      endpoint: current.defaultEndpoint,
      models: [current.defaultModel],
      recommended: true,
    }];
  }
  if (name === "xai") {
    return [{
      id: "default",
      label: "xAI (Grok Build)",
      description: "Used with runtime grok-build. Local Grok sign-in or a stored API key; not Anthropic-compatible.",
      endpoint: current.defaultEndpoint,
      models: [current.defaultModel, "grok-4", "grok-3"],
      recommended: true,
    }];
  }
  if (name === "minimax") {
    return [
      {
        id: "international",
        label: "International",
        description: "For accounts created on the international MiniMax platform.",
        endpoint: "https://api.minimax.io/anthropic",
        models: ["MiniMax-M3", "MiniMax-M3[1m]"],
        recommended: current.defaultEndpoint === "https://api.minimax.io/anthropic",
      },
      {
        id: "china",
        label: "China",
        description: "For accounts created on the mainland China MiniMax platform.",
        endpoint: "https://api.minimaxi.com/anthropic",
        models: ["MiniMax-M3", "MiniMax-M3[1m]"],
        recommended: current.defaultEndpoint === "https://api.minimaxi.com/anthropic",
      },
    ];
  }
  if (name === "qwen") {
    return [
      {
        id: "token-plan",
        label: "Token Plan",
        description: "Personal or Team Token Plan in Alibaba Model Studio.",
        endpoint: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
        models: ["qwen3.8-max-preview", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash"],
        recommended: true,
      },
      {
        id: "coding-plan",
        label: "Coding Plan",
        description: "Alibaba Model Studio Coding Plan.",
        endpoint: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        models: ["qwen3.7-plus"],
      },
      {
        id: "payg-beijing",
        label: "Pay-as-you-go, Beijing",
        description: "Standard Model Studio API key billed per request.",
        endpoint: "https://dashscope.aliyuncs.com/apps/anthropic",
        models: ["qwen3.6-plus"],
        recommended: current.defaultEndpoint === "https://dashscope.aliyuncs.com/apps/anthropic",
      },
    ];
  }
  if (name === "glm") {
    return [
      {
        id: "token-plan",
        label: "Token Plan",
        description: "Alibaba Model Studio Personal or Team Token Plan.",
        endpoint: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
        models: ["glm-5.2"],
        recommended: true,
      },
    ];
  }
  if (name === "volcengine") {
    return [{
      id: "coding-plan",
      label: "Coding Plan",
      description: "Volcengine ARK Coding Plan through the Anthropic Messages compatible endpoint.",
      endpoint: "https://ark.cn-beijing.volces.com/api/coding",
      models: ["glm-5.2[1M]"],
      recommended: true,
    }];
  }
  // FL-D18: list official DeepSeek Claude-compatible models, not only the current default.
  // Default remains recommended when it matches; all listed models stay selectable.
  const deepseekModels = [
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-v4-pro[1m]",
  ];
  if (!deepseekModels.includes(current.defaultModel)) {
    deepseekModels.unshift(current.defaultModel);
  }
  return [{
    id: "default",
    label: "DeepSeek API",
    description: "Direct Anthropic-compatible DeepSeek endpoint (Flash and Pro families).",
    endpoint: current.defaultEndpoint,
    models: deepseekModels,
    recommended: true,
  }];
}

export interface ProviderReadiness {
  ready: boolean;
  /** Bounded local authentication path; never contains credential material. */
  authMode: "api-key" | "local-sign-in" | "none";
  endpoint: string;
  defaultModel: string;
  keychainService: string;
  error?: string;
}

export interface ProviderAuthInspector {
  /** Prove the exact Keychain read used at Worker launch without retaining the value. */
  hasReadableKeychainValue(keychainService: string, keychainAccount?: string): boolean;
  hasLocalGrokSignIn(): boolean;
  hasLocalCodexSignIn?(): boolean;
}

interface ProviderLaunchAuthentication {
  ready: boolean;
  authMode: "api-key" | "local-sign-in" | "none";
  failureCategory?: "authentication";
  reasonCode?: "provider-auth-unreadable";
}

/** Check only that Grok has a readable, non-empty local sign-in file.
 *  The file path, metadata, and contents never leave this boundary. */
export function hasLocalGrokSignIn(): boolean {
  try {
    const authFile = path.join(homedir(), ".grok", "auth.json");
    accessSync(authFile, constants.R_OK);
    const metadata = statSync(authFile);
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
}

/** Check only the minimum local Codex credential file required for a
 * task-local auth seed. Contents and paths never leave this boundary.
 * A symlinked auth file fails closed because the launch-time seed copies only
 * regular files; reporting ready here would contradict the launch boundary. */
export function hasLocalCodexSignIn(codexHome = path.join(homedir(), ".codex")): boolean {
  try {
    const authFile = path.join(codexHome, "auth.json");
    accessSync(authFile, constants.R_OK);
    const metadata = lstatSync(authFile);
    return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0;
  } catch {
    return false;
  }
}

export function realProviderAuthInspector(): ProviderAuthInspector {
  return {
    hasReadableKeychainValue(keychainService, keychainAccount) {
      try {
        execFileSync(
          "security",
          [
            "find-generic-password",
            "-a",
            keychainAccount ?? localAccountName(),
            "-s",
            keychainService,
            "-w",
          ],
          // `-w` exercises the launch-time read path. Discarding stdout means
          // readiness never materializes credential bytes in application code.
          { stdio: "ignore" },
        );
        return true;
      } catch {
        return false;
      }
    },
    hasLocalGrokSignIn,
    hasLocalCodexSignIn,
  };
}

/**
 * Resolve the local authentication path for one exact Task. This is not a
 * Provider connectivity probe: it only proves that Worker launch can reach a
 * readable credential (or Grok's supported local sign-in fallback).
 */
export function providerLaunchAuthentication(
  spec: Pick<TaskSpec, "provider" | "runtime">,
  inspector: ProviderAuthInspector = realProviderAuthInspector(),
): ProviderLaunchAuthentication {
  const keychainReady = spec.provider.name !== "openai" && inspector.hasReadableKeychainValue(
    spec.provider.keychainService,
    spec.provider.keychainAccount,
  );
  const localSignInReady = spec.provider.name === "xai"
    && spec.runtime.name === "grok-build"
    && inspector.hasLocalGrokSignIn();
  const localCodexReady = spec.provider.name === "openai"
    && spec.runtime.name === "codex-cli"
    && (inspector.hasLocalCodexSignIn?.() ?? false);
  if (keychainReady) return { ready: true, authMode: "api-key" };
  if (localSignInReady || localCodexReady) return { ready: true, authMode: "local-sign-in" };
  return {
    ready: false,
    authMode: "none",
    failureCategory: "authentication",
    reasonCode: "provider-auth-unreadable",
  };
}

export function providerReadiness(
  defaults: ProviderDefaultsSettings = cloneDefaults().providerDefaults,
  inspector: ProviderAuthInspector = realProviderAuthInspector(),
): {
  anyReady: boolean;
  providers: Record<ProviderName, ProviderReadiness>;
} {
  let anyReady = false;
  const providers = {} as Record<ProviderName, ProviderReadiness>;
  for (const name of providerNames()) {
    const definition = providerDefinition(name, defaults);
    const keychainReady = name !== "openai"
      && inspector.hasReadableKeychainValue(definition.defaultKeychainService);
    const localSignInReady = (name === "xai" && inspector.hasLocalGrokSignIn())
      || (name === "openai" && (inspector.hasLocalCodexSignIn?.() ?? false));
    const authMode: ProviderReadiness["authMode"] = keychainReady
      ? "api-key"
      : localSignInReady ? "local-sign-in" : "none";
    const ready = authMode !== "none";
    if (ready) anyReady = true;
    providers[name] = {
      ready,
      authMode,
      endpoint: definition.defaultEndpoint,
      defaultModel: definition.defaultModel,
      keychainService: definition.defaultKeychainService,
      ...(ready ? {} : { error: "Local authentication not found" }),
    };
  }
  return { anyReady, providers };
}
