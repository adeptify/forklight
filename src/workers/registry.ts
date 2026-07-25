import type { RuntimeName } from "../core/runtime-names.js";
import { isRuntimeName, supportedRuntimeNamesList } from "../core/runtime-names.js";
import type { WorkerAdapter } from "./types.js";
import { createBuiltinAdapters } from "./register-builtins.js";

const adapters = new Map<RuntimeName, WorkerAdapter>();
let builtinsRegistered = false;

/** Idempotent registration of built-in adapters (Claude, Grok, …). */
export function ensureBuiltinsRegistered(): void {
  if (builtinsRegistered) return;
  for (const adapter of createBuiltinAdapters()) {
    adapters.set(adapter.name, adapter);
  }
  builtinsRegistered = true;
}

/** Register or replace an adapter for its `name`. */
export function registerWorkerAdapter(adapter: WorkerAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getWorkerAdapter(name: string): WorkerAdapter {
  ensureBuiltinsRegistered();
  if (!isRuntimeName(name)) {
    throw new Error(
      `Unknown worker runtime: ${name}. Supported: ${supportedRuntimeNamesList()}`,
    );
  }
  const adapter = adapters.get(name);
  if (adapter === undefined) {
    throw new Error(
      `Worker runtime ${name} is not registered. Supported: ${supportedRuntimeNamesList()}`,
    );
  }
  return adapter;
}

export function listWorkerAdapters(): WorkerAdapter[] {
  ensureBuiltinsRegistered();
  return [...adapters.values()];
}

/** Test helper: clear registry (does not re-register builtins until ensure/get). */
export function resetWorkerRegistryForTests(): void {
  adapters.clear();
  builtinsRegistered = false;
}
