import type {
  InstallResult,
  MainInstallComponent,
  MainSurfaceStatus,
} from "../hub/main-install.js";
import type {
  SetupNextAction,
  SetupStatusInput,
  SetupStatusView,
  SetupWorkerOption,
} from "./types.js";

const GROK_WORKER = "grok-4-6-xhigh";

/** Read-only first-setup projection. Never starts Hub, Task, Worker, or a probe. */
export function projectSetupStatus(input: SetupStatusInput): SetupStatusView {
  const blocking = input.prerequisites.find((item) => item.blocker && (item.id === "platform" || item.id === "node"));
  const readyProviders = input.providers.filter((item) => item.configured);
  const selectedWorker = input.workers.find((item) => item.selected) ?? null;
  const workerReady = selectedWorker !== null && providerReady(input, selectedWorker.provider);
  const launchableWorker = firstLaunchableWorker(input);
  const anyMain = input.mains.some((item) => item.installed);
  const preferredReady = readyProviders.find((item) => item.name === input.defaultProvider)
    ?? readyProviders[0]
    ?? null;

  if (blocking !== undefined) {
    const command = "forklight setup status";
    return view(input, {
      ready: false,
      fact: `${blocking.label} is not ready.`,
      reason: blocking.message,
      nextAction: {
        code: "fix-prerequisite",
        command,
        message: blocking.fix ?? `Fix ${blocking.label}, then run ${command}.`,
      },
      providerReady: false,
      workerReady: false,
    });
  }

  if (preferredReady === null) {
    return view(input, {
      ready: false,
      fact: "No provider is ready.",
      reason: "There is no local Grok or Codex sign-in and no stored API key.",
      nextAction: {
        code: "select-provider",
        command: "forklight setup provider select --provider xai",
        message: "Sign in to Grok, then run: forklight setup provider select --provider xai",
      },
      providerReady: false,
      workerReady: false,
    });
  }

  if (!workerReady) {
    const profile = launchableWorker?.id ?? GROK_WORKER;
    const command = `forklight setup worker select --profile ${profile}`;
    return view(input, {
      ready: false,
      fact: `${preferredReady.label} is ready, but the selected Worker is not.`,
      reason: selectedWorker === null
        ? "No built-in Worker is selected."
        : "The selected Worker uses a provider that is not ready.",
      nextAction: {
        code: "select-worker",
        command,
        message: `Select a built-in Worker: ${command}`,
      },
      providerReady: true,
      workerReady: false,
    });
  }

  if (!anyMain) {
    const client = mainClientForWorker(selectedWorker);
    const command = `forklight setup main install --client ${client} --component mcp --confirm`;
    return view(input, {
      ready: false,
      fact: "Provider and Worker are ready. No Main connection is installed.",
      reason: "ForkLight is not yet connected to Grok, Codex, or Claude Code.",
      nextAction: {
        code: "install-main",
        command,
        message: `Install a Main connection: ${command}`,
      },
      providerReady: true,
      workerReady: true,
    });
  }

  return view(input, {
    ready: true,
    fact: "Setup is ready.",
    reason: "A provider, a built-in Worker, and a Main connection are in place.",
    nextAction: {
      code: "ready",
      command: "forklight doctor",
      message: "Run forklight doctor, then use the usual delivery commands.",
    },
    providerReady: true,
    workerReady: true,
  });
}

export function renderSetupStatusHuman(status: SetupStatusView): string {
  return `fact: ${status.fact}\nreason: ${status.reason}\nnext: ${status.nextAction.message}\n`;
}

export function renderSetupStatusJson(status: SetupStatusView): string {
  return `${JSON.stringify(status, null, 2)}\n`;
}

export function projectMainSetupResult(
  result: InstallResult | MainSurfaceStatus,
  component: MainInstallComponent,
): {
  ok: boolean;
  action: string;
  message: string;
  backupPath?: string;
  targetPath?: string;
  newSessionNeeded: boolean;
} {
  if ("plugin" in result && "mcp" in result && "skill" in result) {
    const backupPath = result.mcp.backupPath;
    const changed = result.message.includes("Installed")
      || result.message.includes("Removed")
      || result.mcp.action === "installed"
      || result.mcp.action === "uninstalled";
    return {
      ok: result.ok,
      action: component === "all" ? "all" : result.mcp.action,
      message: result.message,
      ...(backupPath === undefined ? {} : { backupPath }),
      ...(result.mcp.targetPath === undefined ? {} : { targetPath: result.mcp.targetPath }),
      newSessionNeeded: result.ok && changed,
    };
  }
  return {
    ok: result.ok,
    action: result.action,
    message: result.message,
    ...(result.backupPath === undefined ? {} : { backupPath: result.backupPath }),
    ...(result.targetPath === undefined ? {} : { targetPath: result.targetPath }),
    newSessionNeeded: result.ok && (result.action === "installed" || result.action === "uninstalled"),
  };
}

function providerReady(input: SetupStatusInput, name: string): boolean {
  return input.providers.some((item) => item.name === name && item.configured);
}

function firstLaunchableWorker(input: SetupStatusInput): SetupWorkerOption | undefined {
  const grok = input.workers.find((item) => item.id === GROK_WORKER && providerReady(input, item.provider));
  if (grok !== undefined) return grok;
  return input.workers.find((item) => providerReady(input, item.provider));
}

function mainClientForWorker(worker: SetupWorkerOption | null): string {
  if (worker?.runtime === "codex-cli") return "codex";
  if (worker?.runtime === "claude-code") return "claude-code";
  return "grok-build";
}

function view(
  input: SetupStatusInput,
  parts: {
    ready: boolean;
    fact: string;
    reason: string;
    nextAction: SetupNextAction;
    providerReady: boolean;
    workerReady: boolean;
  },
): SetupStatusView {
  const preferred = input.providers.find((item) => item.name === input.defaultProvider && item.configured)
    ?? input.providers.find((item) => item.configured)
    ?? input.providers.find((item) => item.name === input.defaultProvider)
    ?? null;
  const selectedWorker = input.workers.find((item) => item.selected) ?? null;
  return {
    ready: parts.ready,
    fact: parts.fact,
    reason: parts.reason,
    nextAction: parts.nextAction,
    provider: {
      name: preferred?.name ?? null,
      label: preferred?.label ?? null,
      authMode: preferred?.authMode ?? "none",
      ready: parts.providerReady,
    },
    worker: {
      id: selectedWorker?.id ?? null,
      label: selectedWorker?.label ?? null,
      ready: parts.workerReady,
    },
    main: {
      anyInstalled: input.mains.some((item) => item.installed),
      clients: input.mains.map((item) => ({ client: item.client, installed: item.installed })),
    },
  };
}
