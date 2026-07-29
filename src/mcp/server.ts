import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { forklightHome } from "../core/config.js";
import type { ProviderModelSummary } from "../core/statistics.js";
import type { RoutingAdvisoryResponse } from "../core/model-routing.js";
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
import { buildCompactIntegrationOperationView } from "../core/integration-operation.js";
import type { IntegrationOperationView } from "../core/types.js";
import {
  isTaskPresentationLanguage,
  parseTaskSpec,
  TASK_PRESENTATION_SUMMARY_MAX,
} from "../core/task.js";
import {
  assessTaskQualityWithPolicy,
  effectiveQualityPolicyFromGlobal,
} from "../core/contract-quality.js";
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
import { SUPPORTED_RUNTIME_NAMES } from "../core/runtime-names.js";
import { isPricingRouteId, resolveWorkerSelection } from "../core/worker-profiles.js";

const SERVER_INSTRUCTIONS =
  "ForkLight runs bounded external coding Workers (runtimes: claude-code default, optional grok-build with provider xai). The Main agent may be Claude Code, Grok Build, OpenCode, Codex, or a human using CLI/Console — not Codex-only. Before submit, the Main agent must align the solution and provide a complete Task Contract covering outcome, scope, execution, modules, call chain, scenarios, risks, and independent acceptance. Validate first. Submit returns immediately. Prefer forklight_wait over tight-loop status. Use forklight_list for progress-aware boards. Status may include failureCategory authentication|budget|runtime|contract-infeasible. Worker runtime is chosen by task.runtime (or defaultRuntime), independent of which Main client is connected. Record taskId for continuity across Main sessions. The Main agent remains accountable for review and user approvals. Never call ForkLight a native subagent of the Main product, and never use it to commit or push.";

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

const taskPresentationSchema = z.object({
  summary: z.string()
    .min(1)
    .max(TASK_PRESENTATION_SUMMARY_MAX)
    .refine(
      (value) => value === value.trim()
        && !/[\r\n\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      { message: "summary must be one trimmed paragraph" },
    ),
  language: z.string().refine(isTaskPresentationLanguage, {
    message: "language must be a bounded BCP-47-like tag",
  }),
}).strict();

const taskInputSchema = z.object({
  project: z.string().min(1).describe("Absolute path to the source project"),
  name: z.string().min(1).max(120),
  contract: z.object({
    outcome: z.string().min(12),
    presentation: taskPresentationSchema.optional(),
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
  provider: z.enum(["deepseek", "qwen", "minimax", "glm", "volcengine", "xai"]).optional(),
  model: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  // Worker runtime (claude-code | grok-build). Omit → default worker profile / defaultRuntime.
  runtime: z.enum(SUPPORTED_RUNTIME_NAMES).optional(),
  runtimeExecutable: z.string().min(1).optional(),
  /** Named Worker profile id from settings.workerProfiles (overrides defaults). */
  workerProfileId: z.string().min(1).max(64).optional(),
  // FL-D92: null = unlimited (no --max-budget-usd). Omit to inherit effective default.
  // Must not use z.number().positive().optional() alone — that rejects null and forced
  // callers to invent a positive cap when defaultMaxBudgetUsd is null.
  maxBudgetUsd: z.number().positive().nullable().optional(),
  allowEdits: z.boolean().default(true),
  focusPaths: z.array(z.string().min(1)).min(1),
  generatedPaths: z.array(z.string().min(1).max(240)).optional(),
  delivery: deliverySpecSchema.optional(),
  deliveryProfileId: z.string().min(1).max(64).optional(),
  /** Explicit billing route override. Wins over Worker profile setting.
   *  Bounded non-empty identifier; never a credential. */
  pricingRoute: z.string().refine(isPricingRouteId, {
    message: "pricingRoute must be a bounded non-empty identifier",
  }).optional(),
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
  _budget: MaxBudgetResolution = resolveMaxBudgetUsd(
    input.maxBudgetUsd,
    settings.execution.defaultMaxBudgetUsd,
  ),
): Record<string, unknown> {
  const resolved = resolveWorkerSelection(
    {
      ...(input.workerProfileId === undefined ? {} : { workerProfileId: input.workerProfileId }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      ...(input.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: input.maxBudgetUsd }),
      ...(input.pricingRoute === undefined ? {} : { pricingRoute: input.pricingRoute }),
    },
    {
      execution: settings.execution,
      providerDefaults: settings.providerDefaults,
      workerProfiles: settings.workerProfiles,
      modelCatalog: settings.modelCatalog,
    },
  );
  // Explicit MCP maxBudgetUsd wins; else worker profile budget; else settings default (via resolve).
  const effectiveBudget = resolveMaxBudgetUsd(
    input.maxBudgetUsd !== undefined ? input.maxBudgetUsd : resolved.maxBudgetUsd,
    settings.execution.defaultMaxBudgetUsd,
  );
  const defaultExecutable = resolved.runtime === "grok-build" ? "grok" : "claude";
  return {
    version: 2,
    name: input.name,
    project: input.project,
    contract: input.contract,
    ...(resolved.profileId === undefined ? {} : { workerProfileId: resolved.profileId }),
    provider: {
      name: resolved.provider,
      model: resolved.model,
      keychainService: resolved.keychainService,
      endpoint: resolved.endpoint,
      ...(resolved.pricingRoute === undefined ? {} : { pricingRoute: resolved.pricingRoute }),
    },
    runtime: {
      name: resolved.runtime,
      executable: input.runtimeExecutable ?? defaultExecutable,
      effort: resolved.effort,
      maxBudgetUsd: effectiveBudget.maxBudgetUsd,
    },
    workspace: {
      ...(input.generatedPaths === undefined ? {} : { generatedPaths: input.generatedPaths }),
    },
    worker: { allowEdits: input.allowEdits, allowedCommands: [], focusPaths: input.focusPaths },
    ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
    ...(input.deliveryProfileId === undefined ? {} : { deliveryProfileId: input.deliveryProfileId }),
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
        workerProfiles: settings.workerProfiles,
        modelCatalog: settings.modelCatalog,
        deliveryProfiles: settings.deliveryProfiles,
      };
      const budget = resolveMaxBudgetUsd(
        input.maxBudgetUsd,
        settings.execution.defaultMaxBudgetUsd,
      );
      const inline = inlineTask(input, settings, budget);
      const spec = parseTaskSpec(inline, input.project, policy);
      const report = assessTaskQualityWithPolicy(
        spec,
        spec.qualityPolicy ?? effectiveQualityPolicyFromGlobal(settings.contractQuality),
      );
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
    "forklight_correct",
    {
      title: "Authorize a Main correction",
      description:
        "Authorize one explicit bounded correction for a failed or interrupted Worker whose candidate has useful parts worth reusing. The Worker continues in its existing workspace and session with the same Task id; independent verification reruns all original acceptance commands. For Tasks with candidate revision evidence, first call forklight_correction_eligibility, then provide candidateRevisionId, reusablePaths, and remainingGaps together. Limited by the Task's frozen maxMainCorrections, not maxExtraAttempts. Requires bounded feedback, explicit confirm, and an optional per-Attempt runtime budget (null = uncapped).",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        feedback: z.string().trim().min(1).max(1000),
        maxBudgetUsd: z.number().positive().nullable().optional(),
        candidateRevisionId: z.string().uuid().optional(),
        reusablePaths: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
        remainingGaps: z.array(z.object({
          description: z.string().trim().min(10).max(500),
          acceptanceExpectation: z.string().trim().min(10).max(500),
        }).strict()).min(1).max(8).optional(),
        confirm: z.literal(true),
      }).strict().superRefine((value, context) => {
        const structuredCount = [
          value.candidateRevisionId,
          value.reusablePaths,
          value.remainingGaps,
        ].filter((item) => item !== undefined).length;
        if (structuredCount !== 0 && structuredCount !== 3) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "candidateRevisionId, reusablePaths, and remainingGaps must be provided together",
          });
        }
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ taskId, feedback, maxBudgetUsd, candidateRevisionId, reusablePaths, remainingGaps }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_correct",
        home,
        args: {
          taskId,
          feedbackLength: feedback.trim().length,
          maxBudgetUsd: maxBudgetUsd ?? null,
          structuredGapContract: candidateRevisionId !== undefined,
          confirm: true,
        },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const task = await daemonRequest<TaskRecord>(
            "correct",
            {
              taskId,
              feedback,
              ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
              ...(candidateRevisionId === undefined ? {} : {
                candidateRevisionId,
                reusablePaths,
                remainingGaps,
              }),
              confirm: true,
            },
            home,
          );
          return textAndData(
            buildTaskSummary(task),
            `ForkLight task ${taskId} was queued for Main correction. The Worker will reuse the existing workspace and session. Poll forklight_status.`,
          );
        },
      });
    },
  );

  server.registerTool(
    "forklight_main_review",
    {
      title: "Record Main agent review",
      description:
        "Record an explicit Main agent accept, revise, or reject judgment against the latest independent verification. This does not authorize source Integration.",
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
            `Main agent review recorded as ${decision}; source Integration is still separately authorized.`,
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
    "forklight_model_routing",
    {
      title: "Evidence-aware model routing advisory",
      description:
        "Provide a read-only, evidence-aware routing advisory for an exact taskClass and two or more provider/model candidates. Recommends a model only when comparable historical evidence is sufficient; otherwise returns unknown. Competition advice is separate from evidence uncertainty and requires Main's explicit intent plus enabled triggers. Non-model failures (credentials, provider errors, policy, workspace, interruption) never penalize a model. Official-cost comparison is available only when all candidates have exact same-currency Provider-native quotes. Duration contributes zero weight by default. Never launches work, switches a Worker, disables a model, or mutates settings.",
      inputSchema: z.object({
        taskClass: z.string().trim().min(1).max(200)
          .describe("Exact task class identifier — never pattern-matched or inferred"),
        candidates: z.array(z.object({
          provider: z.string().trim().min(1).max(100),
          model: z.string().trim().min(1).max(200),
          runtime: z.string().trim().max(50).optional()
            .describe("Worker runtime (e.g. claude-code, grok-build). Omitted for legacy comparisons."),
          effort: z.string().trim().max(10).optional()
            .describe("Worker effort level. Omitted for legacy comparisons."),
        })).min(2).max(10),
        taskFamily: z.string().trim().max(80).optional()
          .describe("Stable task family for cross-project evidence fallback when exact-class evidence is insufficient"),
        competitionIntent: z.enum(["none", "consider", "required"]).optional()
          .describe("Main's explicit Competition intent from the routing decision"),
        competitionTriggers: z.array(z.enum(["critical", "multiple-plausible-solutions", "new-family", "user-requested"])).optional()
          .describe("Main's Competition triggers from the routing decision"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskClass, candidates, taskFamily, competitionIntent, competitionTriggers }) => {
      await ensureDaemon(home);
      const advisory = await daemonRequest<RoutingAdvisoryResponse>(
        "model_routing",
        { taskClass, candidates, taskFamily, competitionIntent, competitionTriggers },
        home,
      );
      const rec = advisory.recommendation;
      const suggestions: string[] = [];
      if (rec) {
        suggestions.push(`Model routing recommends ${rec.provider}/${rec.model} (confidence ${rec.confidence}) for task class "${taskClass}".`);
      } else {
        suggestions.push(`Model routing advice for "${taskClass}": evidence is unknown (scope=${advisory.evidenceScope}).`);
      }
      if (advisory.shouldRunCompetition) {
        suggestions.push(`Competition advised: intent=${advisory.competition.intent}, matching triggers=${advisory.competition.matchingTriggers.join(", ") || "none"}.`);
      } else {
        suggestions.push(`Competition not advised (intent=${advisory.competition.intent}).`);
      }
      return textAndData(advisory, suggestions.join(" "));
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
        "EXPLICITLY apply a reviewed and approved integration to source. REQUIRES a prior passing preflight receipt. This MUTATES source files — never call this without explicit Main agent / user approval. The confirm parameter must be true.",
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
        "Return compact stage aggregates and status for an integration operation by default. Set detail=full only for deep audit with raw command stdout/stderr evidence. Read-only.",
      inputSchema: z.object({
        operationId: z.string().uuid(),
        detail: z.enum(["compact", "full"]).default("compact").describe(
          "compact (default): aggregate counts per stage, no raw command text. full: complete durable evidence including command stdout/stderr.",
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ operationId, detail }) => {
      let taskId: string | undefined;
      return withMcpExchangeReceipt({
        operation: "forklight_integration_status",
        home,
        args: { operationId, detail },
        taskId: () => taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const view = await daemonRequest<IntegrationOperationView>(
            "integration_status",
            { operationId },
            home,
          );
          if (typeof view.taskId === "string") taskId = view.taskId;
          if (detail === "full") return textAndData(view);
          return textAndData(buildCompactIntegrationOperationView(view));
        },
      });
    },
  );

  server.registerTool(
    "forklight_integration_wait",
    {
      title: "Wait for an integration operation",
      description:
        "Wait up to timeoutMs for an integration operation, returning compact stage aggregates by default. Set detail=full only for deep audit with raw command stdout/stderr. A timeout reports outcome-unknown while background work may continue.",
      inputSchema: z.object({
        operationId: z.string().uuid(),
        timeoutMs: z.number().int().min(1).max(3_600_000),
        detail: z.enum(["compact", "full"]).default("compact").describe(
          "compact (default): aggregate counts per stage, no raw command text. full: complete durable evidence including command stdout/stderr.",
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ operationId, timeoutMs, detail }) => {
      let taskId: string | undefined;
      return withMcpExchangeReceipt({
        operation: "forklight_integration_wait",
        home,
        args: { operationId, timeoutMs, detail },
        taskId: () => taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const view = await daemonRequest<IntegrationOperationView>(
            "integration_wait",
            { operationId, timeoutMs },
            home,
          );
          if (typeof view.taskId === "string") taskId = view.taskId;
          if (detail === "full") return textAndData(view);
          return textAndData(buildCompactIntegrationOperationView(view));
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
          providerName: z.enum(["deepseek", "qwen", "minimax", "glm", "volcengine", "xai"]),
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
        provider: z.enum(["deepseek", "qwen", "minimax", "glm", "volcengine", "xai"]).optional().describe(
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
        provider: z.enum(["deepseek", "qwen", "minimax", "glm", "volcengine", "xai"]).optional().describe(
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

  // --- Bounded adaptation control surfaces ----------------------------------
  // Two thin handlers that delegate all identity, validation, gate logic,
  // successor creation, and one-successor enforcement to the daemon.

  const adaptationReasonSchema = z.enum([
    "duration-budget",
    "size-policy",
    "attempt-budget",
    "completion-policy",
    "concurrency-cap",
    "no-progress-timeout",
    "other-flexible-policy",
  ]);

  server.registerTool(
    "forklight_adaptation_preview",
    {
      title: "Preview a bounded policy adaptation",
      description:
        "Preview the before/after fields and eligibility for one bounded Worker-policy adjustment against a terminal Task. Read-only — never creates a Task or mutates state. The proposed patch may only contain flexible advanced-policy fields; maxAdaptationRounds and authority-bearing fields are forbidden.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        patch: z.record(z.string(), z.unknown()).describe(
          "Flexible advanced-policy fields to preview (e.g. maxDurationMs, fileLimit, changeBudgetMode). maxAdaptationRounds is forbidden.",
        ),
        reason: adaptationReasonSchema.describe(
          "Bounded proposed-reason category describing the intent of the patch.",
        ),
      }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId, patch, reason }) => {
      await ensureDaemon(home);
      const preview = await daemonRequest<Record<string, unknown>>(
        "adaptation_preview", { taskId, patch, reason }, home,
      );
      return textAndData(
        preview,
        `Adaptation preview for ${taskId}: ${preview.status}${preview.summary ? ` — ${preview.summary}` : ""}`,
      );
    },
  );

  server.registerTool(
    "forklight_adaptation_apply",
    {
      title: "Apply a confirmed bounded policy adaptation",
      description:
        "Apply one bounded Worker-policy adjustment, creating at most one successor Task. Requires explicit confirm: true. The root immutable maxAdaptationRounds cap is enforced; a parent can have at most one successor. Never triggers a model call or creates more than one successor.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        patch: z.record(z.string(), z.unknown()).describe(
          "Flexible advanced-policy fields to adjust. maxAdaptationRounds is forbidden.",
        ),
        reason: adaptationReasonSchema.describe(
          "Bounded proposed-reason category describing the intent of the patch.",
        ),
        confirm: z.literal(true).describe(
          "Explicit confirmation that the adaptation transition is approved. Must be true.",
        ),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskId, patch, reason }) => {
      await ensureDaemon(home);
      const result = await daemonRequest<Record<string, unknown>>(
        "adaptation_apply",
        { taskId, patch, reason, confirm: true },
        home,
      );
      const childSummary = result.childTaskId !== undefined
        ? `successor created: ${result.childTaskId}`
        : "no successor created";
      return textAndData(
        result,
        `Adaptation apply for ${taskId}: ${result.status} — ${childSummary}`,
      );
    },
  );

  // --- Main remediation verification ----------------------------------------
  // Thin handler that delegates all identity, validation, acceptance-
  // command execution, and persistence to the daemon.

  server.registerTool(
    "forklight_remediation_verify",
    {
      title: "Verify Main-repaired source delivery",
      description:
        "Run acceptance commands against the current source in an isolated copy. Requires explicit confirm: true. Never resumes a Worker, calls a model, or mutates source. Only failed or interrupted Tasks (or succeeded Tasks with a bound Main revise) are eligible, and only one passing final disposition per Task. Optional amendment replaces only exact failed commands from the latest bound verification; passing commands stay immutable.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        reason: z.string().trim().min(1).max(1000),
        confirm: z.literal(true).describe(
          "Explicit confirmation that Main has repaired the source and wants to verify. Must be true.",
        ),
        amendment: z.object({
          verificationEventSequence: z.number().int().positive(),
          reasonCode: z.literal("contradictory-acceptance"),
          replacements: z.array(z.object({
            originalCommand: z.string().min(1).max(4000),
            replacementCommand: z.string().min(1).max(4000),
          }).strict()).min(1).max(50),
        }).strict().optional().describe(
          "Optional one-to-one failed-command replacements bound to the latest verification event. Never mutates the stored Task Contract.",
        ),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskId, reason, amendment }) => {
      // Exchange receipts carry only lengths/counts — never command text.
      return withMcpExchangeReceipt({
        operation: "forklight_remediation_verify",
        home,
        args: {
          taskId,
          reasonLength: reason.length,
          confirm: true,
          ...(amendment === undefined
            ? {}
            : {
                amendmentReplacementCount: amendment.replacements.length,
                amendmentReasonCode: amendment.reasonCode,
                amendmentVerificationEventSequence: amendment.verificationEventSequence,
              }),
        },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const result = await daemonRequest<Record<string, unknown>>(
            "remediation_verify",
            {
              taskId,
              reason,
              confirm: true,
              ...(amendment === undefined ? {} : { amendment }),
            },
            home,
          );
          const check = result.check as Record<string, unknown> | undefined;
          const disposition = result.disposition as Record<string, unknown> | undefined;
          const basis =
            disposition?.acceptanceBasis === "amended-acceptance"
              ? " Amended acceptance basis recorded."
              : disposition?.status === "verified-repaired-delivered"
                ? " Final delivery recorded."
                : "";
          return textAndData(
            result,
            `Main remediation verification ${check?.status ?? "unknown"}: Task ${taskId}.${basis}`,
          );
        },
      });
    },
  );

  // --- Candidate reverification (verification-only, no Worker) --------------
  // Thin handler that delegates all eligibility, acceptance-command rerun,
  // canonical verification evidence, and Task status management to the daemon.

  server.registerTool(
    "forklight_correction_eligibility",
    {
      title: "Check Main correction eligibility",
      description:
        "Return a read-only eligibility check for Main correction (candidate reuse). Reports stable category, frozen allowance, and latest revision summary without running commands or exposing private content. Always call this before calling forklight_correct to verify the action is available and to surface why when it is not.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_correction_eligibility",
        home,
        args: { taskId },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const eligibility = await daemonRequest<Record<string, unknown>>(
            "correction_eligibility",
            { taskId },
            home,
          );
          return textAndData(
            eligibility,
            eligibility.eligible
              ? `Task ${taskId} is eligible for one Main correction (${(eligibility.allowance as Record<string, unknown>).remaining} remaining).`
              : `Task ${taskId} is not eligible for Main correction: ${eligibility.category}.`,
          );
        },
      });
    },
  );

  server.registerTool(
    "forklight_candidate_reverify",
    {
      title: "Reverify a failed candidate without a Worker",
      description:
        "Rerun a failed Task's complete original acceptance suite against the retained candidate WITHOUT launching a Worker or creating another Attempt. Only eligible when the latest independent verification failed behavior acceptance while policy and source compatibility passed, a non-empty business Diff is retained, no Attempt is running, and the frozen maxMainReverifications allowance remains. The original Attempt record and status are preserved. Worker invoked = no, incremental Worker Tokens = 0, incremental model/provider runtime cost = 0. Local verification time and the Main orchestration exchange are NOT zero; no full-restart saving is claimed without a paired baseline. On pass the Task moves to succeeded but a fresh Main Review accept bound to the new verification is still required before Integration.",
      inputSchema: z.object({
        taskId: z.string().uuid(),
        reason: z.string().trim().min(1).max(1000),
        confirm: z.literal(true).describe(
          "Explicit confirmation that Main wants a verification-only rerun. Must be true.",
        ),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskId, reason }) => {
      return withMcpExchangeReceipt({
        operation: "forklight_candidate_reverify",
        home,
        args: { taskId, reasonLength: reason.length, confirm: true },
        taskId,
        invoke: async () => {
          await ensureDaemon(home);
          const result = await daemonRequest<Record<string, unknown>>(
            "candidate_reverify",
            { taskId, reason, confirm: true },
            home,
          );
          const cost = result.costFacts as Record<string, unknown> | undefined;
          const status = typeof result.status === "string" ? result.status : "unknown";
          return textAndData(
            result,
            `Candidate reverification ${status}: Task ${taskId}.${
              status === "passed"
                ? " Task moved to succeeded; a fresh Main Review accept is still required before Integration."
                : " Task remains failed; the original Attempt record is preserved."
            } Worker invoked=${cost?.workerInvoked ?? false}, incremental Worker Tokens=0, incremental model/provider cost=0, commands ${cost?.passedCommandCount ?? 0}/${cost?.commandCount ?? 0}.`,
          );
        },
      });
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
    "forklight_direct_codex_capture_task",
    {
      title: "Guided capture direct Codex sample by Task identity",
      description:
        "Capture one count-only Codex turn.completed terminal event using a stored Task's calibration identity (exactTaskClass, directCodexProfileId). The daemon derives identity from the stored Task — no metadata fields are needed. Returns content-free pending sample evidence.",
      inputSchema: z.object({
        taskId: z.string().min(1).describe("Opaque non-empty ForkLight Task id (must carry taskClass + directCodexProfileId)"),
        runRef: z.string().min(1).describe("Canonical opaque Codex run reference (e.g. codex-run:<id>)"),
        usage: codexTerminalUsageSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ taskId, runRef, usage }) => {
      await ensureDaemon(home);
      let resolvedTaskId: string | undefined;
      return withMcpExchangeReceipt({
        operation: "forklight_direct_codex_capture",
        home,
        args: { taskId, runRef, usage },
        taskId: () => resolvedTaskId,
        invoke: async () => {
          const sample = await daemonRequest<DirectCodexPairedSample>(
            "direct_codex_guided_capture",
            { forklightTaskId: taskId, codexRunRef: runRef, usage },
            home,
          );
          resolvedTaskId = sample.forklightTaskId;
          return textAndData(
            sample,
            `Direct Codex guided sample ${sample.sampleId} captured for Task ${sample.forklightTaskId}.`,
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
