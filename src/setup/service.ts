import { execFileSync } from "node:child_process";
import { localAccountName } from "../core/config.js";
import {
  isProviderName,
  providerDefinition,
  providerLabel,
  providerNames,
  providerVariantLabel,
  providerVariants,
  hasLocalCodexSignIn,
  hasLocalGrokSignIn,
  resolveProvider as resolveRuntimeProvider,
  type ProviderName,
  type ResolvedProviderConfig,
} from "../core/providers.js";
import type { SettingsService } from "../core/settings.js";
import {
  executionPatchFromProfile,
  isWorkerProfileId,
  materializeWorkerModel,
  setDefaultWorkerProfile,
} from "../core/worker-profiles.js";
import type {
  ResolvedSetupProvider,
  SetupAuthMode,
  SetupBootstrap,
  SetupKeychainStore,
  SetupPrerequisite,
  SetupProviderCommit,
  SetupProviderOption,
  SetupProviderSelection,
  SetupSystemInspector,
  SetupWorkerOption,
  SetupWorkerSelection,
} from "./types.js";

type SetupSettings = Pick<SettingsService, "get" | "update">;

const MODEL_PATTERN = /^[A-Za-z0-9._+:/\[\]-]{1,128}$/;

function compatibleRuntimeForProvider(
  provider: ProviderName,
): "grok-build" | "codex-cli" {
  if (provider === "xai") return "grok-build";
  if (provider === "openai") return "codex-cli";
  throw new Error(
    "Local sign-in is only available for xAI and OpenAI. No settings were changed.",
  );
}

export function createSystemInspector(): SetupSystemInspector {
  return {
    platform: () => process.platform,
    nodeVersion: () => process.version,
    account: localAccountName,
    commandExists(command) {
      try {
        execFileSync("which", [command], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    hasLocalCodexSignIn,
    hasLocalGrokSignIn,
  };
}

export class SetupService {
  constructor(
    private readonly settings: SetupSettings,
    private readonly keychain: SetupKeychainStore,
    private readonly system: SetupSystemInspector,
  ) {}

  inspectPrerequisites(): SetupPrerequisite[] {
    const platform = this.system.platform();
    const nodeVersion = this.system.nodeVersion();
    const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? 0);
    const checks: SetupPrerequisite[] = [
      {
        id: "platform",
        label: "macOS",
        ready: platform === "darwin",
        blocker: platform !== "darwin",
        message: platform === "darwin" ? "Supported" : `Detected ${platform}`,
        ...(platform === "darwin" ? {} : { fix: "ForkLight setup currently stores keys in macOS Keychain." }),
      },
      {
        id: "node",
        label: "Node.js 24+",
        ready: major >= 24,
        blocker: major < 24,
        message: `Detected ${nodeVersion}`,
        ...(major >= 24 ? {} : { fix: "Install Node.js 24 or newer, then run setup again." }),
      },
      this.commandCheck("claude", "Claude Code", "Install Claude Code so provider Workers can run."),
      this.commandCheck("codex", "Codex CLI", "Install Codex CLI to use ForkLight as a Codex sub-agent."),
      this.commandCheck("security", "macOS Keychain", "The macOS security command must be available to store API keys."),
    ];
    return checks;
  }

  describeProviders(): SetupProviderOption[] {
    const effective = this.settings.get();
    return providerNames().map((name) => {
      const definition = providerDefinition(name, effective.providerDefaults);
      const auth = this.providerAuth(name);
      return {
        name,
        label: providerLabel(name),
        variantLabel: providerVariantLabel(name),
        configured: auth.configured,
        authMode: auth.authMode,
        defaultModel: definition.defaultModel,
        defaultEndpoint: definition.defaultEndpoint,
        variants: providerVariants(name, effective.providerDefaults),
      };
    });
  }

  currentProvider(): ResolvedSetupProvider | null {
    const effective = this.settings.get();
    const ordered = [
      effective.execution.defaultProvider,
      ...providerNames().filter((name) => name !== effective.execution.defaultProvider),
    ];
    for (const name of ordered) {
      const auth = this.providerAuth(name);
      if (!auth.configured) continue;
      const definition = providerDefinition(name, effective.providerDefaults);
      const variant = providerVariants(name, effective.providerDefaults)
        .find((candidate) => candidate.endpoint === definition.defaultEndpoint);
      return {
        provider: name,
        providerLabel: providerLabel(name),
        variant: variant?.id ?? "custom",
        variantLabel: variant?.label ?? "Custom endpoint",
        model: definition.defaultModel,
        endpoint: definition.defaultEndpoint,
        keychainService: definition.defaultKeychainService,
      };
    }
    return null;
  }

  defaultVariantId(provider: ProviderName): string {
    const variants = providerVariants(provider, this.settings.get().providerDefaults);
    return variants.find((item) => item.recommended)?.id ?? variants[0]?.id ?? "default";
  }

  /** Decide local sign-in vs API-key storage without reading a secret. */
  resolveProviderSetup(selection: SetupProviderSelection): {
    resolved: ResolvedSetupProvider;
    mode: "local-sign-in" | "api-key";
  } {
    const resolved = this.resolveProvider(selection);
    if (resolved.provider === "openai") {
      if (!(this.system.hasLocalCodexSignIn?.() ?? false)) {
        throw new Error(
          "Codex is not signed in locally. Sign in with the Codex CLI, then run this command again. ForkLight does not store an OpenAI API key.",
        );
      }
      return { resolved, mode: "local-sign-in" };
    }
    if (resolved.provider === "xai" && (this.system.hasLocalGrokSignIn?.() ?? false)) {
      return { resolved, mode: "local-sign-in" };
    }
    return { resolved, mode: "api-key" };
  }

  selectSignedInProvider(selection: SetupProviderSelection): SetupProviderCommit {
    const { resolved, mode } = this.resolveProviderSetup(selection);
    if (mode !== "local-sign-in") {
      throw new Error(
        "This provider needs an API key on stdin after --confirm. Local sign-in is not available.",
      );
    }
    this.writeProviderSettings(resolved, compatibleRuntimeForProvider(resolved.provider));
    return { ...resolved, stored: false, settingsUpdated: true, authMode: "local-sign-in" };
  }

  listWorkers(): SetupWorkerOption[] {
    const effective = this.settings.get();
    return effective.workerProfiles.profiles.map((profile) => {
      const model = materializeWorkerModel(
        profile,
        effective.modelCatalog,
        effective.providerDefaults,
      );
      return {
        id: profile.id,
        label: profile.label,
        ...(profile.assignmentGuidance === undefined
          ? {}
          : { assignmentGuidance: profile.assignmentGuidance }),
        runtime: profile.runtime,
        provider: model.provider,
        model: model.model,
        selected: profile.id === effective.workerProfiles.defaultProfileId,
      };
    });
  }

  selectWorker(id: string): SetupWorkerSelection {
    if (!isWorkerProfileId(id)) {
      throw new Error(
        "That Worker id is not valid. No settings were changed. Run `forklight setup worker list` and choose an existing id.",
      );
    }
    const current = this.settings.get();
    const profile = current.workerProfiles.profiles.find((item) => item.id === id);
    if (profile === undefined) {
      throw new Error(
        "That Worker is not in the current settings. No settings were changed. Run `forklight setup worker list` and choose an existing id.",
      );
    }
    const workerProfiles = setDefaultWorkerProfile(current.workerProfiles, id);
    const patch = executionPatchFromProfile(
      profile,
      current.modelCatalog,
      current.providerDefaults,
    );
    this.settings.update({
      workerProfiles,
      execution: patch.execution,
      providerDefaults: patch.providerDefaults,
    });
    const model = materializeWorkerModel(
      profile,
      current.modelCatalog,
      current.providerDefaults,
    );
    return {
      id: profile.id,
      label: profile.label,
      runtime: profile.runtime,
      provider: model.provider,
      model: model.model,
    };
  }

  bootstrap(): SetupBootstrap {
    return {
      prerequisites: this.inspectPrerequisites(),
      providers: this.describeProviders(),
      current: this.currentProvider(),
    };
  }

  resolveProvider(selection: SetupProviderSelection): ResolvedSetupProvider {
    if (!isProviderName(selection.provider)) throw new Error("Unsupported provider");
    const effective = this.settings.get();
    const definition = providerDefinition(selection.provider, effective.providerDefaults);
    const variant = providerVariants(selection.provider, effective.providerDefaults)
      .find((candidate) => candidate.id === selection.variant);
    if (!variant) throw new Error("Choose a valid provider plan or account region");

    const model = (selection.model?.trim() || variant.models[0] || definition.defaultModel);
    if (!MODEL_PATTERN.test(model)) throw new Error("Model name contains unsupported characters");
    const endpoint = this.validatedEndpoint(selection.endpoint?.trim() || variant.endpoint);
    return {
      provider: selection.provider,
      providerLabel: providerLabel(selection.provider),
      variant: variant.id,
      variantLabel: variant.label,
      model,
      endpoint,
      keychainService: definition.defaultKeychainService,
    };
  }

  resolveRuntimeProvider(selection: SetupProviderSelection): ResolvedProviderConfig {
    const resolved = this.resolveProvider(selection);
    const effective = this.settings.get();
    return resolveRuntimeProvider(
      resolved.provider,
      {
        model: resolved.model,
        endpoint: resolved.endpoint,
        keychainService: resolved.keychainService,
      },
      effective.providerDefaults[resolved.provider],
    );
  }

  commitProvider(selection: SetupProviderSelection, apiKey: string): SetupProviderCommit {
    const resolved = this.resolveProvider(selection);
    if (resolved.provider === "openai") {
      throw new Error("Codex Workers use the local Codex sign-in; no OpenAI API key is stored here");
    }
    this.assertCanStoreCredential(apiKey);
    const account = this.system.account();
    const hadPrevious = this.keychain.has(resolved.keychainService, account);
    const previous = hadPrevious
      ? this.keychain.read(resolved.keychainService, account)
      : undefined;
    if (hadPrevious && previous === undefined) {
      throw new Error("The existing Keychain entry could not be backed up. No changes were made.");
    }

    try {
      this.keychain.write(resolved.keychainService, account, apiKey);
    } catch {
      throw new Error("ForkLight could not store the API key in macOS Keychain. Settings were not changed.");
    }

    try {
      this.writeProviderSettings(resolved);
    } catch {
      try {
        if (previous === undefined) this.keychain.delete(resolved.keychainService, account);
        else this.keychain.write(resolved.keychainService, account, previous);
      } catch {
        throw new Error("Settings could not be saved and the Keychain rollback did not complete. Retry setup before running a Worker.");
      }
      throw new Error("Settings could not be saved. The previous Keychain state was restored.");
    }

    return { ...resolved, stored: true, settingsUpdated: true, authMode: "api-key" };
  }

  private providerAuth(name: ProviderName): { configured: boolean; authMode: SetupAuthMode } {
    const definition = providerDefinition(name, this.settings.get().providerDefaults);
    const account = this.system.account();
    if (name === "openai") {
      const ready = this.system.hasLocalCodexSignIn?.() ?? false;
      return { configured: ready, authMode: ready ? "local-sign-in" : "none" };
    }
    const keyReady = this.keychain.has(definition.defaultKeychainService, account);
    const grokReady = name === "xai" && (this.system.hasLocalGrokSignIn?.() ?? false);
    if (keyReady) return { configured: true, authMode: "api-key" };
    if (grokReady) return { configured: true, authMode: "local-sign-in" };
    return { configured: false, authMode: "none" };
  }

  private writeProviderSettings(
    resolved: ResolvedSetupProvider,
    defaultRuntime?: "grok-build" | "codex-cli",
  ): void {
    this.settings.update({
      execution: {
        defaultProvider: resolved.provider,
        ...(defaultRuntime === undefined ? {} : { defaultRuntime }),
      },
      providerDefaults: {
        [resolved.provider]: {
          defaultModel: resolved.model,
          defaultEndpoint: resolved.endpoint,
          defaultKeychainService: resolved.keychainService,
        },
      },
    });
  }

  private commandCheck(command: string, label: string, fix: string): SetupPrerequisite {
    const ready = this.system.commandExists(command);
    return {
      id: command === "security" ? "keychain" : command as "claude" | "codex",
      label,
      ready,
      blocker: !ready,
      message: ready ? "Available" : "Not found",
      ...(ready ? {} : { fix }),
    };
  }

  private validatedEndpoint(value: string): string {
    if (value.length > 512) throw new Error("Endpoint is too long");
    let endpoint: URL;
    try {
      endpoint = new URL(value);
    } catch {
      throw new Error("Endpoint must be a valid HTTPS URL");
    }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
      throw new Error("Endpoint must be an HTTPS URL without embedded credentials");
    }
    return endpoint.href.replace(/\/$/, "");
  }

  private assertCanStoreCredential(apiKey: string): void {
    if (this.system.platform() !== "darwin" || !this.system.commandExists("security")) {
      throw new Error("macOS Keychain is not available. No credential was stored.");
    }
    if (apiKey.length < 8 || apiKey.length > 4096 || /[\0\r\n]/.test(apiKey)) {
      throw new Error("API key format is invalid");
    }
  }
}
