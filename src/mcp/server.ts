import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { forklightHome } from "../core/config.js";
import type { TaskRecord } from "../core/types.js";
import { daemonRequest, ensureDaemon } from "../daemon/client.js";

const SERVER_INSTRUCTIONS =
  "ForkLight runs bounded external coding Workers. Use submit only after the main Codex agent has aligned the solution, supplied explicit acceptance commands, and decided delegation is useful. Submit returns immediately: poll status, then inspect the diff and verification result. The main Codex agent remains accountable for review and user approvals. Never call ForkLight a native Codex subagent, and never use it to commit or push.";

function textAndData(data: unknown, summary?: string): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const structuredContent = data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { value: data };
  return {
    content: [{ type: "text", text: summary ?? JSON.stringify(data, null, 2) }],
    structuredContent,
  };
}

function taskSummary(task: TaskRecord): Record<string, unknown> {
  return {
    taskId: task.id,
    name: task.name,
    status: task.status,
    model: task.spec.provider.model,
    runtime: task.spec.runtime.name,
    sourcePath: task.sourcePath,
    workspacePath: task.paths.workspace,
    sessionId: task.sessionId,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function createForkLightMcpServer(home = forklightHome()): McpServer {
  const server = new McpServer(
    { name: "forklight", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "forklight_health",
    {
      title: "Check ForkLight",
      description: "Check whether the local ForkLight daemon, Claude Code, and DeepSeek credential are ready.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const health = await ensureDaemon(home);
      return textAndData(health);
    },
  );

  server.registerTool(
    "forklight_submit",
    {
      title: "Delegate coding task",
      description:
        "Submit a bounded coding task to an isolated external Worker. Returns a task ID immediately. Use only after defining the goal, constraints, and independent acceptance commands.",
      inputSchema: z.object({
        project: z.string().min(1).describe("Absolute path to the source project"),
        name: z.string().min(1).max(120),
        goal: z.string().min(1),
        constraints: z.array(z.string().min(1)).default([]),
        acceptanceCommands: z.array(z.string().min(1)).min(1),
        model: z.string().min(1).default("deepseek-v4-flash"),
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
        maxBudgetUsd: z.number().positive().max(20).default(0.5),
        allowEdits: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      await ensureDaemon(home);
      const task = await daemonRequest<TaskRecord>(
        "submit",
        {
          baseDirectory: input.project,
          task: {
            version: 1,
            name: input.name,
            project: input.project,
            goal: input.goal,
            constraints: input.constraints,
            provider: {
              name: "deepseek",
              model: input.model,
              keychainService: "forklight.deepseek.api-key",
            },
            runtime: {
              name: "claude-code",
              executable: "claude",
              effort: input.effort,
              maxBudgetUsd: input.maxBudgetUsd,
            },
            worker: { allowEdits: input.allowEdits, allowedCommands: [] },
            acceptance: { commands: input.acceptanceCommands },
          },
        },
        home,
      );
      const summary = taskSummary(task);
      return textAndData(
        summary,
        `ForkLight task ${task.id} was queued for ${input.model}. Poll forklight_status with this task ID.`,
      );
    },
  );

  server.registerTool(
    "forklight_status",
    {
      title: "Get Worker status",
      description: "Get the current status of one ForkLight task without waiting for completion.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId }) => {
      await ensureDaemon(home);
      const task = await daemonRequest<TaskRecord>("status", { taskId }, home);
      return textAndData(taskSummary(task));
    },
  );

  server.registerTool(
    "forklight_inspect",
    {
      title: "Inspect Worker result",
      description:
        "Inspect attempts, normalized events, verification output, and diff for a ForkLight task. The main Codex agent must review this before accepting the work.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId }) => {
      await ensureDaemon(home);
      const result = await daemonRequest<Record<string, unknown>>("inspect", { taskId }, home);
      const diff = typeof result.diff === "string" && result.diff.length > 120_000
        ? `${result.diff.slice(0, 120_000)}\n[diff truncated by ForkLight MCP]`
        : result.diff;
      const bounded = { ...result, diff };
      return textAndData(bounded, JSON.stringify(bounded, null, 2));
    },
  );

  server.registerTool(
    "forklight_resume",
    {
      title: "Resume interrupted Worker",
      description: "Queue an interrupted or failed ForkLight task for another attempt using its existing session.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ taskId }) => {
      await ensureDaemon(home);
      const task = await daemonRequest<TaskRecord>("resume", { taskId }, home);
      return textAndData(
        taskSummary(task),
        `ForkLight task ${taskId} was queued for resume. Poll forklight_status.`,
      );
    },
  );

  server.registerTool(
    "forklight_list",
    {
      title: "List ForkLight tasks",
      description: "List recent ForkLight tasks and their current status.",
      inputSchema: z.object({
        statuses: z
          .array(z.enum(["queued", "preparing", "running", "verifying", "succeeded", "failed", "interrupted"]))
          .optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ statuses, limit }) => {
      await ensureDaemon(home);
      const tasks = await daemonRequest<TaskRecord[]>(
        "list",
        { ...(statuses === undefined ? {} : { statuses }), limit },
        home,
      );
      const summaries = tasks.map(taskSummary);
      return {
        content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }],
        structuredContent: { tasks: summaries },
      };
    },
  );

  return server;
}

export async function runForkLightMcpServer(): Promise<void> {
  const server = createForkLightMcpServer();
  await server.connect(new StdioServerTransport());
}
