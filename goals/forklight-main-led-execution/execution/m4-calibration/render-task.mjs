import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const project = process.argv[2];
if (!project || !path.isAbsolute(project)) {
  throw new Error("usage: node render-task.mjs <absolute-delegated-project>");
}

const input = JSON.parse(await readFile(path.join(project, "calibration-input.json"), "utf8"));
const outputPath = input.outputPath;
const spec = {
  version: 2,
  name: input.taskLabel ?? `M4-D ${input.family} delegated Main calibration`,
  project,
  taskClass: input.taskClass,
  taskFamily: input.family,
  directCodexProfileId: input.directCodexProfileId,
  workerProfileId: "grok-4-6-xhigh",
  executionPreference: "auto",
  routingDecision: {
    taskFamily: input.family,
    shortlist: [{
      provider: "xai",
      model: "grok-4.6",
      runtime: "grok-build",
      effort: "xhigh",
      workerProfileId: "grok-4-6-xhigh",
    }],
    selectedWorker: {
      provider: "xai",
      model: "grok-4.6",
      runtime: "grok-build",
      effort: "xhigh",
      workerProfileId: "grok-4-6-xhigh",
    },
    selectedBecause: {
      code: "user-specified",
      note: input.selectionNote
        ?? "The accepted M4-D calibration requires one Grok 4.6 Xhigh native Goal delegated delivery.",
    },
    competition: { intent: "none", triggers: [] },
    evidenceSnapshot: { scope: "none", exactSampleCounts: {} },
  },
  reviewRequirement: {
    requiredJudges: 2,
    reason: "Main Token evidence requires two different-view Judges to confirm factual accuracy, identical acceptance and no claim widening.",
  },
  provider: {
    name: "xai",
    model: "grok-4.6",
    endpoint: "https://api.x.ai/v1",
    keychainService: "forklight.xai.api-key",
  },
  runtime: {
    name: "grok-build",
    executable: "grok",
    effort: "xhigh",
    maxBudgetUsd: null,
  },
  networkPolicy: {
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
    noProxy: "localhost,127.0.0.1,::1",
  },
  contract: {
    outcome: input.task,
    presentation: {
      summary: input.presentationSummary ?? `生成 ${input.family} 的单份可验证校准事实，不修改产品。`,
      language: "zh-CN",
    },
    context: [
      "Read calibration-input.json completely. It is the complete same-scope evidence and work contract shared with the direct Main run.",
      `Write exactly ${outputPath} and no other path. The pre-existing empty file is the only accepted output.`,
      "Use the supplied evidence only. Do not inspect ForkLight Store, sibling Tasks, Provider credentials, private histories or the source project.",
      "ForkLight serves one local developer. Add no lock, lease, checksum system, version handshake or distributed coordination mechanism.",
      "This is one fresh Grok 4.6 Xhigh native Goal. One Attempt is available; there is no extra Attempt, replacement, fallback, reroute, model switch or Competition.",
    ],
    inScope: [
      "Read the bounded evidence and task statement from calibration-input.json.",
      "Project the factual JSON requested by the family contract at the exact output path.",
      "Inspect the completed JSON against the supplied evidence before returning a concise handoff.",
    ],
    outOfScope: [
      "Any product source, test, Hub/UI, routing, Store, historical Task, credential, Git remote, commit, push or reset change.",
      "Any additional artifact, schema field, inferred fact, model ranking, synthetic task, retry, replacement or Integration action.",
    ],
    executionSteps: [
      "Read the complete input and identify the exact required projection.",
      "Write the single bounded JSON artifact with no extra fields or private content.",
      "Self-inspect the artifact; ForkLight independently runs the shared validator and diff check.",
    ],
    deliverables: [
      `One factual artifact at ${outputPath}.`,
      "A concise handoff naming the output, evidence used and any remaining uncertainty.",
    ],
    modules: [{
      name: "Bounded evidence projection",
      responsibility: "Convert the supplied accepted facts into the one closed family JSON schema.",
      consumes: ["calibration-input.json"],
      produces: [outputPath],
      boundaries: ["No live Store access", "no product mutation", "no extra path"],
    }],
    callChain: [
      "Main prepares byte-identical direct and delegated comparison sources.",
      "Grok reads the delegated copy and writes one artifact in its isolated Workspace.",
      "ForkLight independently validates the exact schema and Candidate diff.",
      "Two independent Judges review the same Revision; Main alone decides and integrates into the delegated comparison project.",
    ],
    scenarios: [{
      name: "Accepted factual projection",
      given: "The bounded input and empty output path are present in the isolated Workspace.",
      when: "Grok projects only the supplied evidence into the required schema.",
      then: "The validator passes and the one-path Candidate can enter the independent quality chain.",
    }, {
      name: "Unsupported fact or path",
      given: "The proposed output adds a field, private content, unsupported claim or second path.",
      when: "ForkLight verifies the Candidate.",
      then: "Verification fails closed and no Integration occurs.",
    }],
    risks: [
      "A plausible summary could overstate historical truth; the closed validator requires exact supplied facts.",
      "A second write would invalidate pair scope; Worker path ownership is exactly one output file.",
    ],
    changeBudget: { maxFiles: 1, maxDiffLines: 400 },
  },
  advancedPolicy: {
    maxDurationMs: null,
    observedTokenCeiling: null,
    noProgressTimeoutMs: null,
    workerStopGraceMs: 60000,
    fileLimit: 1,
    fileLimitMode: "hard",
    changedLineLimit: 400,
    changedLineLimitMode: "warn",
    baseMaxAttempts: 1,
    maxExtraAttempts: 0,
    maxMainCorrections: 1,
    maxMainReverifications: 1,
    maxWorkerValidationRepairs: 1,
    maxConcurrency: 1,
    completionMode: "warn",
    changeBudgetMode: "warn",
    maxAdaptationRounds: 0,
  },
  completionPolicy: {
    noChangeMode: "hard",
    changeBudgetMode: "warn",
  },
  workspace: {
    exclude: [".git", "node_modules", "dist", ".runtime", ".forklight", "plans"],
    generatedPaths: [],
  },
  worker: {
    allowEdits: true,
    allowedCommands: [],
    focusPaths: [outputPath],
  },
  acceptance: {
    criteria: [
      "The Candidate changes exactly one path and contains one readable JSON object under 16 KiB.",
      "Every factual value matches calibration-input.json; no extra field, private content or unsupported claim exists.",
      "The family-specific no-mutation boundary remains explicit and true.",
      "One Grok 4.6 Xhigh native Goal, independent verification, two different-view Judges, Main decision and safe serial Integration complete the delegated quality chain.",
    ],
    commands: [input.acceptanceCommand, "git diff --check"],
  },
};

const taskPath = path.join(path.dirname(project), `${input.family}-task.json`);
await writeFile(taskPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ taskPath, project, family: input.family })}\n`);
