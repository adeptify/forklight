import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CheckpointReport } from "../core/types.js";
import { daemonRequest } from "../daemon/client.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
      const report = await daemonRequest<CheckpointReport>(
        "checkpoint_run",
        {
          taskId,
          attemptId,
          ...(commandIds === undefined ? {} : { commandIds }),
        },
        home,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        structuredContent: report as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

export async function runCheckpointMcpServer(): Promise<void> {
  const server = createCheckpointMcpServer();
  await server.connect(new StdioServerTransport());
}
