import type { WorkerAdapter } from "./types.js";
import { ClaudeCodeAdapter } from "./claude.js";
import { GrokBuildAdapter } from "./grok.js";

/** Build built-in adapters without touching the registry (avoids circular imports). */
export function createBuiltinAdapters(): WorkerAdapter[] {
  return [new ClaudeCodeAdapter(), new GrokBuildAdapter()];
}
