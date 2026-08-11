import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sleepMs } from "../core/time.js";
import type { CheckpointOperationView, CheckpointReport } from "../core/types.js";
import { daemonRequest, isDaemonTransportUnavailable } from "../daemon/client.js";
import type { DaemonMethod } from "../daemon/protocol.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Bounded observation window for one daemon exchange. The long checkpoint is
 *  observed across repeated exchanges, so no single transport can false-timeout. */
const CHECKPOINT_WAIT_BOUND_MS = 5_000;
/** Bounded retries around daemon transport gaps (e.g. a daemon restart). The
 *  budget covers a typical daemon restart; observation never starts a daemon. */
const CHECKPOINT_OBSERVE_RETRIES = 20;
const CHECKPOINT_OBSERVE_RETRY_DELAY_MS = 500;

/**
 * Daemon exchange with bounded transport-gap retries. Business errors are
 * propagated immediately; transport gaps (restart, socket loss) are retried
 * with a short backoff so a daemon restart mid-operation is observed as
 * outcome-unknown rather than a false failure.
 */
async function checkpointDaemonRequest<T>(
  method: DaemonMethod,
  params: Record<string, unknown>,
  home: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CHECKPOINT_OBSERVE_RETRIES; attempt += 1) {
    try {
      return await daemonRequest<T>(method, params, home);
    } catch (error) {
      if (!isDaemonTransportUnavailable(error)) throw error;
      lastError = error;
      await sleepMs(CHECKPOINT_OBSERVE_RETRY_DELAY_MS);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("ForkLight checkpoint observation failed");
}

export function scrubCheckpointEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|CLIENT_SECRET|PRIVATE_KEY)/i.test(name)) {
      delete environment[name];
    }
  }
}

function createCheckpointMcpServer(
  home = requiredEnv("FORKLIGHT_HOME"),
  taskId = requiredEnv("FORKLIGHT_CHECKPOINT_TASK_ID"),
  attemptId = requiredEnv("FORKLIGHT_CHECKPOINT_ATTEMPT_ID"),
): McpServer {
  const server = new McpServer(
    { name: "forklight-checkpoint", version: "0.2.0" },
    {
      instructions:
        "Run only the current Task Contract acceptance commands by deterministic command id. "
        + "Results are non-authoritative checkpoints; ForkLight independently reruns all commands.",
    },
  );

  server.registerTool(
    "run",
    {
      title: "Run approved checkpoint commands",
      description: "Run approved Task Contract acceptance commands by id.",
      inputSchema: z.object({
        commandIds: z.array(z.string().regex(/^acceptance-[1-9][0-9]*$/)).optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ commandIds }) => {
      // Start once through a short exchange; the daemon launches the approved
      // command set in the background and returns a stable operation identity.
      let view = await daemonRequest<CheckpointOperationView>(
        "checkpoint_start",
        {
          taskId,
          attemptId,
          ...(commandIds === undefined ? {} : { commandIds }),
        },
        home,
      );
      // Observe the same operation through bounded daemon exchanges until it is
      // terminal. No single exchange can false-timeout a long checkpoint.
      while (view.status === "running") {
        view = await checkpointDaemonRequest<CheckpointOperationView>(
          "checkpoint_wait",
          { operationId: view.operationId, timeoutMs: CHECKPOINT_WAIT_BOUND_MS },
          home,
        );
      }
      if (view.status === "completed") {
        const report = await checkpointDaemonRequest<CheckpointReport>(
          "checkpoint_report",
          { operationId: view.operationId },
          home,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      }
      throw new Error(
        view.status === "outcome-unknown"
          ? "ForkLight checkpoint outcome is unknown after a daemon restart; the approved commands were not rerun"
          : "ForkLight checkpoint failed before producing a report",
      );
    },
  );

  return server;
}

export async function runCheckpointMcpServer(): Promise<void> {
  const server = createCheckpointMcpServer();
  await server.connect(new StdioServerTransport());
}
