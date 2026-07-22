import type { ProviderName, ProviderVariant } from "../core/providers.js";

export interface SetupPrerequisite {
  id: "platform" | "node" | "claude" | "codex" | "keychain";
  label: string;
  ready: boolean;
  blocker: boolean;
  message: string;
  fix?: string;
}

export interface SetupProviderOption {
  name: ProviderName;
  label: string;
  variantLabel: string;
  configured: boolean;
  defaultModel: string;
  defaultEndpoint: string;
  variants: ProviderVariant[];
}

export interface SetupProviderSelection {
  provider: ProviderName;
  variant: string;
  model?: string;
  endpoint?: string;
}

export interface ResolvedSetupProvider {
  provider: ProviderName;
  providerLabel: string;
  variant: string;
  variantLabel: string;
  model: string;
  endpoint: string;
  keychainService: string;
}

export interface SetupProviderCommit extends ResolvedSetupProvider {
  stored: true;
  settingsUpdated: true;
}

export interface SetupBootstrap {
  prerequisites: SetupPrerequisite[];
  providers: SetupProviderOption[];
  current: ResolvedSetupProvider | null;
}

export interface SetupSystemInspector {
  platform(): string;
  nodeVersion(): string;
  account(): string;
  commandExists(command: string): boolean;
}

export interface SetupKeychainStore {
  has(service: string, account: string): boolean;
  read(service: string, account: string): string | undefined;
  write(service: string, account: string, value: string): void;
  delete(service: string, account: string): void;
}
