import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { forklightHome } from "../core/config.js";
import type { ProviderModelSummary } from "../core/statistics.js";
import type { DirectCodexPairedSample } from "../core/direct-codex-calibration.js";
import type {
  AttemptRecord,
  EventRecord,
  TaskDecisionView,
  TaskRecord,
} from "../core/types.js";
import {
  resolveMaxBudgetUsd,
  type MaxBudgetResolution,
} from "../core/budget.js";
import { assessIntegrationFeasibility } from "../core/integration-feasibility.js";
import { assessTaskQuality, parseTaskSpec } from "../core/task.js";
import { type ProviderName } from "../core/providers.js";
import { daemonRequest, ensureDaemon } from "../daemon/client.js";
import type { ForkLightSettings, TaskPolicy } from "../core/settings.js";
import {
  buildCompactInspection,
  buildProgressCursor,
  waitForTask,
  type TaskProgressSnapshot,
} from "../cli/supervision.js";
import { withMcpExchangeReceipt } from "./exchange-receipts.js";
import { buildTaskSummary, type SafeTaskSummary } from "../core/task-summary.js";
import {
  compareBuildIdentity,
  currentBuildIdentity,
  isBuildIdentity,
} from "../core/build-identity.js";

const SERVER_INSTRUCTIONS =
  "ForkLight runs bounded external coding Workers through DeepSeek, Qwen, MiniMax, or GLM. Before submit, the main Codex agent must align the solution and provide a complete Task Contract covering outcome, scope, execution, module inputs and outputs, call chain, scenarios, risks, and independent acceptance. Validate the contract first. Submit returns immediately. Prefer forklight_wait (event-sequence or terminal) for supervision instead of tight-loop status/inspect. Use forklight_list for progress-aware board summaries (activity/lastEventAt). Compact inspect (summary=true) is for post-terminal review. Status may include failureCategory authentication|budget|runtime. The main Codex agent remains accountable for review and user approvals. Never call ForkLight a native Codex subagent, and never use it to commit or push.";

const moduleContractSchema = z.object({
  name: z.string().min(1),
  responsibility: z.string().min(8),
  consumes: z.array(z.string().min(1)).min(1),
  produces: z.array(z.string().min(1)).min(1),
  boundaries: z.array(z.string().min(1)).min(1),
});

const scenarioContractSchema = z.object({
  name: z.string().min(1),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});

const deliverySpecSchema = z.object({
  buildCommands: z.array(z.string().trim().min(1)).max(16).default([]),
  activationCommands: z.array(z.string().trim().min(1)).max(16).default([]),
  activationCheckCommands: z.array(z.string().trim().min(1)).max(16).default([]),
}).strict();

const taskInputSchema = z.object({
  project: z.string().min(1).describe("Absolute path to the source project"),
  name: z.string().min(1).max(120),
  contract: z.object({
    outcome: z.string().min(12),
    context: z.array(z.string().min(1)).min(1),
    inScope: z.array(z.string().min(1)).min(1),
    outOfScope: z.array(z.string().min(1)).min(1),
    executionSteps: z.array(z.string().min(1)).min(1),
    deliverables: z.array(z.string().min(1)).min(1),
    modules: z.array(moduleContractSchema).min(1),
    callChain: z.array(z.string().min(1)).min(2),
    scenarios: z.array(scenarioContractSchema).min(2),
    risks: z.array(z.string().min(1)).min(1),
    changeBudget: z.object({
      maxFiles: z.number().int().positive(),
      maxDiffLines: z.number().int().positive(),
    }),
  }),
  acceptance: z.object({
    criteria: z.array(z.string().min(1)).min(1),
    commands: z.array(z.string().min(1)).min(1),
  }),
  provider: z.enum(["deepseek", "qwen", "minimax", "glm"]).optional(),
  model: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  // FL-D92: null = unlimited (no --max-budget-usd). Omit to inherit effective default.
  // Must not use z.number().positive().optional() alone — that rejects null and forced
  // callers to invent a positive cap when defaultMaxBudgetUsd is null.
  maxBudgetUsd: z.number().positive().nullable().optional(),
  allowEdits: z.boolean().default(true),
  focusPaths: z.array(z.string().min(1)).min(1),
  generatedPaths: z.array(z.string().min(1).max(240)).optional(),
  delivery: deliverySpecSchema.optional(),
});

type TaskInput = z.infer<typeof taskInputSchema>;

/**
 * Build the YAML-shaped task document MCP submit/validate feed into parseTaskSpec.
 * Optional pre-resolved `budget` avoids double resolve on validate (FL-D92).
 * Exported for unit tests of the real MCP budget adapter.
 */
export function inlineTask(
  input: TaskInput,
  settings: ForkLightSettings,
  budget: MaxBudgetResolution = resolveMaxBudgetUsd(
    input.maxBudgetUsd,
    settings.execution.defaultMaxBudgetUsd,
  ),
): Record<string, unknown> {
  const providerName = (input.provider ?? settings.execution.defaultProvider) as ProviderName;
  const providerDef = settings.providerDefaults[providerName];
  return {
    version: 2,
    name: input.name,
    project: input.project,
    contract: input.contract,
    provider: {
      name: providerName,
      model: input.model ?? providerDef.defaultModel,
      keychainService: providerDef.defaultKeychainService,
      ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: input.effort ?? settings.execution.defaultEffort,
      maxBudgetUsd: budget.maxBudgetUsd,
    },
    workspace: {
      ...(input.generatedPaths === undefined ? {} : { generatedPaths: input.generatedPaths }),
    },
    worker: { allowEdits: input.allowEdits, allowedCommands: [], focusPaths: input.focusPaths },
    ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
    acceptance: input.acceptance,
  };
}

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

export function createForkLightMcpServer(home = forklightHome()): McpServer {
  const server = new McpServer(
    { name: "forklight", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "forklight_health",
    {
      title: "Check ForkLight",
      description: "Check whether the local ForkLight daemon, Claude Code, and provider credentials are ready.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const health = await ensureDaemon(home);
      const clientBuildIdentity = currentBuildIdentity();
      const daemonBuildIdentity = health.buildIdentity;
      const comparison = isBuildIdentity(daemonBuildIdentity)
        ? compareBuildIdentity(clientBuildIdentity, daemonBuildIdentity)
        : { protocolCompatible: false, sameBuild: false };
      return textAndData({
        ...health,
        mcpBuildIdentity: clientBuildIdentity,
        daemonBuildIdentity,
        identityStatus: comparison.sameBuild
          ? "matched"
          : comparison.protocolCompatible
            ? "build-mismatch"
            : "protocol-mismatch",
        ...(
          comparison.sameBuild
            ? {}
            : { identityAction: "Rebuild and restart ForkLight daemon and MCP before changes" }
        ),
      });
    },
  );

  server.registerTool(
    "forklight_validate",
    {
      title: "Validate coding task contract",
      description:
        "Validate that a bounded coding task has clear scope, module behavior, call chain, scenarios, risks, and independent acceptance before starting a Worker.",
      inputSchema: taskInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      await ensureDaemon(home);
      const settings = await daemonRequest<ForkLightSettings>("settings_get", {}, home);
      const policy: TaskPolicy = {
        contractQuality: settings.contractQuality,
        execution: settings.execution,
        providerDefaults: settings.providerDefaults,
        completionPolicy: settings.completionPolicy,
      };
      const budget = resolveMaxBudgetUsd(
        input.maxBudgetUsd,
        settings.execution.defaultMaxBudgetUsd,
      );
      const inline = inlineTask(input, settings, budget);
      const spec = parseTaskSpec(inline, input.project, policy);
      const report = assessTaskQuality(spec, settings.contractQuality);
      // FL-D10 parity with CLI validate: surface Task budget vs Integration limit.
      const integrationFeasibility = assessIntegrationFeasibility(
        spec,
        settings.integration,
      );
      return textAndData({
        ...report,
        budget: {
          maxBudgetUsd: budget.maxBudgetUsd,
          source: budget.source,
          generatesRuntimeFlag: budget.generatesRuntimeFlag,
        },
        resolvedRuntimeMaxBudgetUsd: spec.runtime.maxBudgetUsd,
        integrationFeasibility,
      });
    },
  );

  server.registerTool(
    "forklight_plan_submit",
    {
      title: "Submit a Work Plan",
      description:
        "Submit a local Work Plan file for coordinated multi-task execution and return its item-to-task mapping.",
      inputSchema: z.object({
        planFile: z.string().min(1).describe("Absolute path to the Work Plan YAML or JSON file"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ planFile }) => {
      await ensureDaemon(home);
      const result = await daemonRequest<Record<string, unknown>>(
        "plan_submit_file",
        { planFile },
        home,
      );
      return textAndData(result);
    },
  );

  server.registerTool(
    "forklight_plan_inspect",
    {
      title: "Inspect a Work Plan board",
      description: "Read one plan's progress, columns, task states, and dependency evidence.",
      inputSchema: z.object({ planId: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ planId }) => {
      await ensureDaemon(home);
      const board = await daemonRequest<Record<string, unknown>>("plan_board", { planId }, home);
      return textAndData(board);
    },
  );

  server.registerTool(
    "forklight_plan_board",
    {
      title: "List Work Plan boards",
      description: "List bounded read-only progress summaries for known Work Plans.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      await ensureDaemon(home);
      const plans = await daemonRequest<Record<string, unknown>[]>(
        "plan_board_overview",
        { limit },
        home,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(plans, null, 2) }],
        structuredContent: { plans },
      };
    },
  );

  server.registerTool(
    "forklight_submit",
    {
      title: "Delegate coding task",
      description:
        "Submit a validated Task Contract to an isolated external Worker. Returns a task ID immediately.",
      inputSchema: taskInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      await ensureDaemon(home);
      const settings = await daemonRequest<ForkLightSettings>("settings_get", {}, home);
      let submittedTaskId: string | undefined;
      return withMcpExchangeReceipt({
        operation: "forklight_submit",
        home,
        args: input,
        taskId: () => submittedTaskId,
        invoke: async () => {
          const task = await daemonRequest<TaskRecord>(
            "submit",
            {
              baseDirectory: input.project,
              task: inlineTask(input, settings),
            },
            home,
          );
          submittedTaskId = task.id;
          const summary = buildTaskSummary(task);
          return textAndData(
            summary,
            `ForkLight task ${task.id} was queued for ${task.spec.provider.name}/${task.spec.provider.model}. Poll forklight_status with this task ID.`,
          );
        },
      });
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
      return withMcpExchangeReceipt({
        operation: "forklight_status",
        home,
        args: { taskId },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const [task, decision] = await Promise.all([
            daemonRequest<TaskRecord>("status", { taskId }, home),
            daemonRequest<TaskDecisionView>("task_decision", { taskId }, home),
          ]);
          return textAndData({
            ...buildTaskSummary(task, decision.progress, decision.failureCategory),
            decision,
          });
        },
      });
    },
  );

  server.registerTool(
    "forklight_wait",
    {
      title: "Wait for Task progress",
      description:
        "Block until a Task terminal state or event-sequence change (same semantics as CLI wait). Prefer this over polling status/inspect. until=change fires when status, latestEventSequence, attempt, or updatedAt cursor advances; until=terminal waits for succeeded/failed/interrupted.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        timeoutMs: z.number().int().positive().max(600_000).default(60_000),
        pollMs: z.number().int().positive().max(60_000).default(1_000),
        until: z.enum(["change", "terminal"]).default("terminal"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId, timeoutMs, pollMs, until }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_wait",
        home,
        args: { taskId, timeoutMs, pollMs, until },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const readProgress = async (): Promise<TaskProgressSnapshot> => {
            const [task, decision] = await Promise.all([
              daemonRequest<TaskRecord>("status", { taskId }, home),
              daemonRequest<TaskDecisionView>("task_decision", { taskId }, home),
            ]);
            // Rebuild latest-event meta from Decision View progress (real store type,
            // never a synthetic "progress" label) so wait lastEventType is truthful.
            const latestEvent = decision.progress.lastEventAt === undefined
              || decision.progress.lastEventType === undefined
              ? undefined
              : {
                sequence: decision.progress.latestEventSequence,
                timestamp: decision.progress.lastEventAt,
                type: decision.progress.lastEventType,
                summary: decision.progress.latestAction ?? "",
              };
            return {
              task,
              cursor: buildProgressCursor(task, latestEvent),
              ...(latestEvent === undefined ? {} : { latestEvent }),
            };
          };
          const result = await waitForTask(
            { timeoutMs, pollMs, until },
            {
              readProgress,
              sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
              now: () => Date.now(),
            },
          );
          return textAndData(result);
        },
      });
    },
  );

  server.registerTool(
    "forklight_inspect",
    {
      title: "Inspect Worker result",
      description:
        "Inspect a ForkLight task. Prefer summary=true (default) for main-thread supervision: compact attempts, bounded events, verification hints, and diff metrics without full diff text. Set summary=false only for deep audit (full events/diff, truncated at 120k).",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        summary: z.boolean().default(true),
        eventLimit: z.number().int().min(0).max(200).default(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId, summary, eventLimit }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_inspect",
        home,
        args: { taskId, summary, eventLimit },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const result = await daemonRequest<Record<string, unknown>>("inspect", { taskId }, home);
          if (summary) {
            const task = result.task as TaskRecord;
            const attempts = result.attempts as AttemptRecord[];
            const events = result.events as EventRecord[];
            const decision = result.decision as TaskDecisionView;
            const diff = typeof result.diff === "string" ? result.diff : undefined;
            const compact = buildCompactInspection({
              task,
              attempts,
              events,
              decision,
              diff,
              eventLimit,
            });
            return textAndData(
              compact,
              `Compact inspect for ${taskId}. Use summary=false only if full events/diff are required.`,
            );
          }
          const diff = typeof result.diff === "string" && result.diff.length > 120_000
            ? `${result.diff.slice(0, 120_000)}\n[diff truncated by ForkLight MCP]`
            : result.diff;
          const bounded = { ...result, diff };
          return textAndData(bounded, JSON.stringify(bounded, null, 2));
        },
      });
    },
  );

  server.registerTool(
    "forklight_resume",
    {
      title: "Resume interrupted Worker",
      description: "Queue an interrupted or failed ForkLight task for another attempt using its existing session.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        feedback: z.string().min(1).optional(),
        authorization: z.object({
          additionalAttempts: z.literal(1),
          maxBudgetUsd: z.number().positive().nullable(),
          reason: z.string().trim().min(1).max(1000),
          confirm: z.literal(true),
        }).strict().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ taskId, feedback, authorization }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_resume",
        home,
        args: {
          taskId,
          ...(feedback === undefined ? {} : { feedback }),
          ...(authorization === undefined ? {} : { authorization }),
        },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const task = await daemonRequest<TaskRecord>(
            "resume",
            {
              taskId,
              ...(feedback === undefined ? {} : { feedback }),
              ...(authorization === undefined ? {} : { authorization }),
            },
            home,
          );
          return textAndData(
            buildTaskSummary(task),
            `ForkLight task ${taskId} was queued for resume. Poll forklight_status.`,
          );
        },
      });
    },
  );

  server.registerTool(
    "forklight_main_review",
    {
      title: "Record Main Codex review",
      description:
        "Record an explicit Main Codex accept, revise, or reject judgment against the latest independent verification. This does not authorize source Integration.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        decision: z.enum(["accept", "revise", "reject"]),
        reason: z.string().trim().min(1).max(1000),
        confirm: z.literal(true),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskId, decision, reason }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_main_review",
        home,
        args: { taskId, decision, reasonLength: reason.length, confirm: true },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const review = await daemonRequest<Record<string, unknown>>(
            "main_review",
            { taskId, decision, reason, confirm: true },
            home,
          );
          return textAndData(
            review,
            `Main Codex review recorded as ${decision}; source Integration is still separately authorized.`,
          );
        },
      });
    },
  );

  server.registerTool(
    "forklight_list",
    {
      title: "List ForkLight tasks",
      description:
        "List recent ForkLight tasks with latest-event progress (activity, lastEventAt, latestAction) and optional failureCategory. Prefer this over status-only polling for board-style supervision.",
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
      const summaries = await daemonRequest<SafeTaskSummary[]>(
        "list_summaries",
        { ...(statuses === undefined ? {} : { statuses }), limit },
        home,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }],
        structuredContent: { tasks: summaries },
      };
    },
  );

  server.registerTool(
    "forklight_statistics",
    {
      title: "Query ForkLight statistics",
      description:
        "Query local provider/model outcomes, failures, costs, and separate timing evidence. Duration is reported but is not a default quality ranking signal.",
      inputSchema: z.object({
        provider: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        since: z.string().datetime({ offset: true }).optional(),
        until: z.string().datetime({ offset: true }).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ provider, model, since, until }) => {
      await ensureDaemon(home);
      const summaries = await daemonRequest<ProviderModelSummary[]>(
        "statistics",
        {
          ...(provider === undefined ? {} : { providerName: provider }),
          ...(model === undefined ? {} : { modelName: model }),
          ...(since === undefined ? {} : { since }),
          ...(until === undefined ? {} : { until }),
        },
        home,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }],
        structuredContent: { summaries },
      };
    },
  );

  server.registerTool(
    "forklight_settings_get",
    {
      title: "Read effective ForkLight settings",
      description:
        "Return the complete effective settings document (defaults merged with persisted overrides). Credential values and fixed safety invariants are never exposed.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      await ensureDaemon(home);
      const settings = await daemonRequest<ForkLightSettings>("settings_get", {}, home);
      return textAndData(settings);
    },
  );

  server.registerTool(
    "forklight_settings_update",
    {
      title: "Update ForkLight settings",
      description:
        "Apply a partial settings patch. Every key must be a known section; unknown or credential-like fields are rejected atomically. Returns the new effective settings on success.",
      inputSchema: z.object({
        patch: z.record(z.string(), z.unknown()).describe(
          "Partial settings object. Top-level keys must be known sections (contractQuality, execution, competition, integration, console, providerDefaults, probe). Nested fields are merged with current values.",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ patch }) => {
      await ensureDaemon(home);
      const settings = await daemonRequest<ForkLightSettings>("settings_update", { patch }, home);
      return textAndData(settings);
    },
  );

  server.registerTool(
    "forklight_settings_reset",
    {
      title: "Reset ForkLight settings to built-in defaults",
      description:
        "Remove all persisted overrides. Returns the restored default settings document. Tasks, plans, and execution history are not affected.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async () => {
      await ensureDaemon(home);
      const settings = await daemonRequest<ForkLightSettings>("settings_reset", {}, home);
      return textAndData(settings);
    },
  );

  server.registerTool(
    "forklight_integration_preflight",
    {
      title: "Preflight integration review",
      description:
        "Perform a dry-run safety review of a task's patch against its source. Returns affected files, rejection reasons, and source evidence. Persists an audit receipt but never mutates the source project.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskId }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_integration_preflight",
        home,
        args: { taskId },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const receipt = await daemonRequest<Record<string, unknown>>(
            "integration_preflight",
            { taskId },
            home,
          );
          return textAndData(receipt);
        },
      });
    },
  );

  server.registerTool(
    "forklight_integration_apply",
    {
      title: "Apply reviewed integration to source",
      description:
        "EXPLICITLY apply a reviewed and approved integration to source. REQUIRES a prior passing preflight receipt. This MUTATES source files — never call this without explicit Main Codex approval. The confirm parameter must be true.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        receiptId: z.string().uuid(),
        confirm: z.literal(true).describe(
          "Explicit confirmation that source mutation is approved. Must be true.",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ taskId, receiptId }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_integration_apply",
        home,
        args: { taskId, receiptId, confirm: true },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const result = await daemonRequest<Record<string, unknown>>(
            "integration_apply",
            { taskId, receiptId, confirm: true },
            home,
          );
          return textAndData(result);
        },
      });
    },
  );

  server.registerTool(
    "forklight_integration_history",
    {
      title: "Read integration history",
      description:
        "Return integration receipts and results for a task. Read-only, never mutates source or state.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_integration_history",
        home,
        args: { taskId },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const history = await daemonRequest<Record<string, unknown>>(
            "integration_history",
            { taskId },
            home,
          );
          return textAndData(history);
        },
      });
    },
  );

  server.registerTool(
    "forklight_integration_status",
    {
      title: "Read integration operation status",
      description:
        "Return the latest durable stage evidence and final result, when available, for an integration operation. Read-only.",
      inputSchema: z.object({ operationId: z.string().uuid() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ operationId }) => {
      let taskId: string | undefined;
      return withMcpExchangeReceipt({
        operation: "forklight_integration_status",
        home,
        args: { operationId },
        taskId: () => taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const view = await daemonRequest<Record<string, unknown>>(
            "integration_status",
            { operationId },
            home,
          );
          if (typeof view.taskId === "string") taskId = view.taskId;
          return textAndData(view);
        },
      });
    },
  );

  server.registerTool(
    "forklight_integration_wait",
    {
      title: "Wait for an integration operation",
      description:
        "Wait up to timeoutMs for an integration operation. A timeout reports outcome-unknown while background work may continue; query status with the same operationId.",
      inputSchema: z.object({
        operationId: z.string().uuid(),
        timeoutMs: z.number().int().min(1).max(3_600_000),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ operationId, timeoutMs }) => {
      let taskId: string | undefined;
      return withMcpExchangeReceipt({
        operation: "forklight_integration_wait",
        home,
        args: { operationId, timeoutMs },
        taskId: () => taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const view = await daemonRequest<Record<string, unknown>>(
            "integration_wait",
            { operationId, timeoutMs },
            home,
          );
          if (typeof view.taskId === "string") taskId = view.taskId;
          return textAndData(view);
        },
      });
    },
  );

  server.registerTool(
    "forklight_compete_submit",
    {
      title: "Start a model competition",
      description:
        "Submit a Task Contract with multiple candidate models. Runs each candidate in an isolated workspace from a single canonical snapshot. Returns the competition ID immediately; poll forklight_competition_status for progress.",
      inputSchema: taskInputSchema.extend({
        candidates: z.array(z.object({
          providerName: z.enum(["deepseek", "qwen", "minimax", "glm"]),
          modelName: z.string().min(1),
          // Per-candidate override: null = unlimited for that candidate (FL-D92 parity).
          maxBudgetUsd: z.number().positive().nullable().optional(),
        })).min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      await ensureDaemon(home);
      const settings = await daemonRequest<ForkLightSettings>("settings_get", {}, home);
      const taskDef = inlineTask(input, settings);
      const competition = await daemonRequest<Record<string, unknown>>(
        "competition_submit",
        { task: taskDef, baseDirectory: input.project, candidates: input.candidates },
        home,
      );
      return textAndData(
        competition,
        `Competition ${competition.id} started with ${input.candidates.length} candidates. Poll forklight_competition_status for progress.`,
      );
    },
  );

  server.registerTool(
    "forklight_competition_status",
    {
      title: "Read competition status",
      description:
        "Read one competition's progress, candidate task statuses, and completed evaluation. No winner is declared while any candidate is still active.",
      inputSchema: z.object({ competitionId: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ competitionId }) => {
      await ensureDaemon(home);
      return textAndData(await daemonRequest<Record<string, unknown>>("competition_status", { competitionId }, home));
    },
  );

  const rankingWeightsSchema = z.object({
    verification: z.number().min(0).optional(),
    diffFocus: z.number().min(0).optional(),
    retries: z.number().min(0).optional(),
    cost: z.number().min(0).optional(),
    duration: z.number().min(0).optional(),
  }).optional();

  server.registerTool(
    "forklight_competition_compare",
    {
      title: "Compare competition candidates",
      description:
        "Return per-factor scores, missing evidence, disqualifications, confidence, and advisory recommendation. Override ranking weights for ephemeral what-if scoring; default comparison returns stored evaluation.",
      inputSchema: z.object({ competitionId: z.string().min(1), rankingWeights: rankingWeightsSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ competitionId, rankingWeights }) => {
      await ensureDaemon(home);
      const params: Record<string, unknown> = { competitionId };
      if (rankingWeights !== undefined) params.rankingWeights = rankingWeights;
      return textAndData(await daemonRequest<Record<string, unknown>>("competition_compare", params, home));
    },
  );

  server.registerTool(
    "forklight_competition_list",
    {
      title: "List competitions",
      description: "List all known competitions with status and candidate progress.",
      inputSchema: z.object({ status: z.enum(["pending", "running", "completed"]).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status }) => {
      await ensureDaemon(home);
      const params: Record<string, unknown> = {};
      if (status !== undefined) params.status = status;
      const list = await daemonRequest<Record<string, unknown>[]>("competition_list", params, home);
      return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }], structuredContent: { competitions: list } };
    },
  );

  server.registerTool(
    "forklight_provider_status",
    {
      title: "Read provider verification status",
      description:
        "Return cached provider verification status (verified, failed, stale, or unverified). This is a safe, read-only operation — it never triggers a probe, incurs no cost, and reveals no secrets.",
      inputSchema: z.object({
        provider: z.enum(["deepseek", "qwen", "minimax", "glm"]).optional().describe(
          "Optional provider name. Omit to return status for all configured providers.",
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ provider }) => {
      await ensureDaemon(home);
      const params: Record<string, unknown> = {};
      if (provider !== undefined) params.provider = provider;
      const result = await daemonRequest<Record<string, unknown>>("provider_status", params, home);
      return textAndData(result, `Provider verification status${provider ? ` for ${provider}` : ""} (cached, read-only).`);
    },
  );

  server.registerTool(
    "forklight_provider_probe",
    {
      title: "Probe provider connectivity",
      description:
        "Run an EXPLICIT live probe against one or all configured providers. This is a MUTATING, potentially billable operation: every request uses the current configured budget, timeout, cache lifetime, and concurrency limits, then persists only safe evidence.",
      inputSchema: z.object({
        provider: z.enum(["deepseek", "qwen", "minimax", "glm"]).optional().describe(
          "Optional provider name. Omit to probe all configured providers with bounded concurrency.",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ provider }) => {
      await ensureDaemon(home);
      const params: Record<string, unknown> = {};
      if (provider !== undefined) params.provider = provider;
      const result = await daemonRequest<Record<string, unknown>>("provider_probe", params, home);
      return textAndData(
        result,
        `Provider probe completed for ${provider ?? "all providers"}. Results are cached; use forklight_provider_status to re-read without cost.`,
      );
    },
  );

  // --- Direct-Codex calibration MCP adapter ---------------------------------
  // Five thin handlers that delegate all identity grammar, arithmetic,
  // Task-pair validation, review immutability, cross-field review semantics,
  // publication readiness, versioning, and persistence to the daemon methods.
  // Only capture is measured with an exchange receipt; pair-level and
  // publication operations are unattributed.

  const codexTerminalUsageSchema = z.object({
    type: z.literal("turn.completed"),
    usage: z.object({
      input_tokens: z.number().int().min(0),
      cached_input_tokens: z.number().int().min(0),
      cache_write_input_tokens: z.number().int().min(0),
      output_tokens: z.number().int().min(0),
      reasoning_output_tokens: z.number().int().min(0),
    }).strict(),
  }).strict();

  const codexSampleMetadataSchema = z.object({
    sampleId: z.string().min(1),
    forklightTaskId: z.string().min(1),
    exactTaskClass: z.string().min(1),
    directCodexProfileId: z.string().min(1),
    directRunRef: z.string().min(1),
    pairingRef: z.string().min(1),
    capturedAt: z.string().min(1),
  }).strict();

  server.registerTool(
    "forklight_direct_codex_capture",
    {
      title: "Capture direct Codex paired sample",
      description:
        "Capture one count-only Codex turn.completed terminal event with seven explicit metadata fields as immutable paired-sample evidence. Delegates identity, arithmetic, and validation to the daemon.",
      inputSchema: z.object({
        usage: codexTerminalUsageSchema,
        metadata: codexSampleMetadataSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ usage, metadata }) => {
      await ensureDaemon(home);
      let resolvedTaskId: string | undefined;
      return withMcpExchangeReceipt({
        operation: "forklight_direct_codex_capture",
        home,
        args: { usage, metadata },
        taskId: () => resolvedTaskId,
        invoke: async () => {
          const sample = await daemonRequest<DirectCodexPairedSample>(
            "direct_codex_capture",
            { usage, metadata },
            home,
          );
          resolvedTaskId = sample.forklightTaskId;
          return textAndData(
            sample,
            `Direct Codex sample ${sample.sampleId} captured for Task ${sample.forklightTaskId}.`,
          );
        },
      });
    },
  );

  server.registerTool(
    "forklight_direct_codex_inbox",
    {
      title: "List direct Codex inbox for exact pair",
      description:
        "Return every DirectCodexPairedSample for the exact taskClass × directCodexProfileId pair, each with its explicit review state. Pending, accepted, and rejected states are included. Read-only.",
      inputSchema: z.object({
        taskClass: z.string().min(1),
        directCodexProfileId: z.string().min(1),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskClass, directCodexProfileId }) => {
      await ensureDaemon(home);
      const items = await daemonRequest<readonly Record<string, unknown>[]>(
        "direct_codex_inbox",
        { taskClass, directCodexProfileId },
        home,
      );
      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }], structuredContent: { samples: items } };
    },
  );

  server.registerTool(
    "forklight_direct_codex_review",
    {
      title: "Record explicit immutable review",
      description:
        "Record one immutable review decision for an existing DirectCodexPairedSample. Accepts 'accepted' or 'rejected' with a bounded enum rejection reason. Requires explicit confirm true. Delegates all identity, decision, and immutability rules to the daemon.",
      inputSchema: z.object({
        confirm: z.literal(true).describe(
          "Explicit confirmation that the review decision is final. Must be true.",
        ),
        sampleId: z.string().min(1),
        decision: z.enum(["accepted", "rejected"]),
        rejectionReason: z.enum([
          "not-equivalent-task",
          "insufficient-quality",
          "incomplete-evidence",
          "duplicate-evidence",
        ]).optional(),
        reviewer: z.literal("main-codex"),
        reviewedAt: z.string().min(1),
        schemaVersion: z.literal(1),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      await ensureDaemon(home);
      const review = await daemonRequest<Record<string, unknown>>(
        "direct_codex_review",
        input as unknown as Record<string, unknown>,
        home,
      );
      return textAndData(
        review,
        `Direct Codex sample ${review.sampleId} review recorded: ${review.decision}.`,
      );
    },
  );

  server.registerTool(
    "forklight_direct_codex_publication_preview",
    {
      title: "Preview direct Codex publication readiness",
      description:
        "Evaluate publication readiness for an exact taskClass × directCodexProfileId pair. Returns accepted/rejected/pending counts, next version, accepted sample IDs, and readiness status. Read-only — never mutates state.",
      inputSchema: z.object({
        taskClass: z.string().min(1),
        directCodexProfileId: z.string().min(1),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskClass, directCodexProfileId }) => {
      await ensureDaemon(home);
      const preview = await daemonRequest<Record<string, unknown>>(
        "direct_codex_publication_preview",
        { taskClass, directCodexProfileId },
        home,
      );
      return textAndData(preview);
    },
  );

  server.registerTool(
    "forklight_direct_codex_publication_register",
    {
      title: "Register direct Codex calibration publication",
      description:
        "Register a confirmed calibration publication from only immutable accepted paired samples. Requires explicit confirm true. Delegates all readiness, versioning, and persistence to the daemon. Evidence set is immutable once registered.",
      inputSchema: z.object({
        confirm: z.literal(true).describe(
          "Explicit confirmation that the publication registration is approved. Must be true.",
        ),
        method: z.string().min(1),
        confidence: z.enum(["low", "medium", "high"]),
        createdAt: z.string().min(1),
        taskClass: z.string().min(1),
        directCodexProfileId: z.string().min(1),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      await ensureDaemon(home);
      const result = await daemonRequest<Record<string, unknown>>(
        "direct_codex_publication_register",
        input as unknown as Record<string, unknown>,
        home,
      );
      return textAndData(
        result,
        `Direct Codex publication version ${(result.summary as Record<string, unknown>).version} registered for ${(result.publication as Record<string, unknown>).directCodexProfileId}.`,
      );
    },
  );

  return server;
}

export async function runForkLightMcpServer(): Promise<void> {
  const server = createForkLightMcpServer();
  await server.connect(new StdioServerTransport());
}
