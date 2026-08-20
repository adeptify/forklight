import type { ProviderName, ProviderVariant } from "../core/providers.js";

export interface SetupPrerequisite {
  id: "platform" | "node" | "claude" | "codex" | "keychain";
  label: string;
  ready: boolean;
  blocker: boolean;
  message: string;
  fix?: string;
}

export type SetupAuthMode = "api-key" | "local-sign-in" | "none";

export interface SetupProviderOption {
  name: ProviderName;
  label: string;
  variantLabel: string;
  configured: boolean;
  authMode: SetupAuthMode;
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
  stored: boolean;
  settingsUpdated: true;
  authMode: Exclude<SetupAuthMode, "none">;
}

export interface SetupWorkerOption {
  id: string;
  label: string;
  assignmentGuidance?: string;
  runtime: string;
  provider: ProviderName;
  model: string;
  selected: boolean;
}

export interface SetupWorkerSelection {
  id: string;
  label: string;
  runtime: string;
  provider: ProviderName;
  model: string;
}

export type SetupNextActionCode =
  | "fix-prerequisite"
  | "select-provider"
  | "select-worker"
  | "install-main"
  | "ready";

export interface SetupNextAction {
  code: SetupNextActionCode;
  message: string;
  command: string;
}

export interface SetupStatusView {
  ready: boolean;
  fact: string;
  reason: string;
  nextAction: SetupNextAction;
  provider: {
    name: ProviderName | null;
    label: string | null;
    authMode: SetupAuthMode;
    ready: boolean;
  };
  worker: {
    id: string | null;
    label: string | null;
    ready: boolean;
  };
  main: {
    anyInstalled: boolean;
    clients: Array<{ client: string; installed: boolean }>;
  };
}

export interface SetupStatusInput {
  prerequisites: SetupPrerequisite[];
  providers: SetupProviderOption[];
  defaultProvider: ProviderName;
  workers: SetupWorkerOption[];
  mains: Array<{ client: string; installed: boolean }>;
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
  hasLocalCodexSignIn?(): boolean;
  hasLocalGrokSignIn?(): boolean;
}

export interface SetupKeychainStore {
  has(service: string, account: string): boolean;
  read(service: string, account: string): string | undefined;
  write(service: string, account: string, value: string): void;
  delete(service: string, account: string): void;
}
