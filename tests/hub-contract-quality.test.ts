/**
 * Hub Contract Quality — round-trip persistence, preview provenance, field
 * separation, validation, edit preservation, and bilingual UI assets.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SettingsService } from "../src/core/settings.js";
import { HubServer } from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { StateStore } from "../src/state/store.js";

class MemoryKeychain implements SetupKeychainStore {
  readonly values = new Map<string, string>();
  private id(s: string, a: string): string { return `${a}:${s}`; }
  has(s: string, a: string): boolean { return this.values.has(this.id(s, a)); }
  read(s: string, a: string): string | undefined { return this.values.get(this.id(s, a)); }
  write(s: string, a: string, v: string): void { this.values.set(this.id(s, a), v); }
  delete(s: string, a: string): void { this.values.delete(this.id(s, a)); }
}

function inspector(overrides: Partial<SetupSystemInspector> = {}): SetupSystemInspector {
  return {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "hub-test-user",
    commandExists: () => true,
    ...overrides,
  };
}

function doHttp(
  u: string,
  method: "GET" | "POST",
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["x-forklight-hub-token"] = token;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    function onRes(res: import("node:http").IncomingMessage): void {
      let d = "";
      res.on("data", (c: Buffer) => { d += c.toString(); });
      res.on("end", () => {
        let parsed: unknown = d;
        try { if (d) parsed = JSON.parse(d); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    }
    if (method === "GET") {
      get(u, { headers }, onRes).on("error", reject);
    } else {
      const req = request(u, { method: "POST", headers }, onRes);
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    }
  });
}

async function makeHub() {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-cq-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  let daemonRunning = true;
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-test-user",
    port: 0,
    ensureDaemon: async () => {
      daemonRunning = true;
      return { ok: true };
    },
    probeDaemon: async () => {
      if (!daemonRunning) return { running: false, error: "not running" };
      return { running: true, health: { ok: true, pid: 1, activeTaskIds: [], queuedTaskIds: [], maxConcurrency: 1 } };
    },
    stopDaemon: async () => {
      daemonRunning = false;
      return { stopped: true, message: "Daemon shutdown requested" };
    },
    restartDaemon: async () => {
      daemonRunning = true;
      return { ok: true };
    },
    daemonRequest: async <T>(method: string) => {
      if (method === "health") return { ok: true, pid: 1 } as T;
      if (method === "list_summaries") return [] as T;
      if (method === "plan_board_overview") return [] as T;
      if (method === "competition_list") return [] as T;
      if (method === "statistics") return [] as T;
      if (method === "settings_get") return settings.get() as T;
      throw new Error(`unexpected ${method}`);
    },
  });
  const port = await server.start();
  return {
    server,
    settings,
    keychain,
    port,
    token: server.getToken(),
    cleanup: async () => {
      await server.stop();
      store.close();
    },
  };
}

// --- Backend HTTP integration tests ---

test("Hub worker preview returns separate quality preview rows with provenance", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftAdvancedPolicy: { maxConcurrency: 1 },
      draftContractQuality: { mode: "warn", maxFiles: null, minScenarios: 0 },
    });
    assert.equal(res.status, 200);
    const body = res.body as {
      ok: boolean;
      preview: Array<Record<string, unknown>>;
      previewQualityPolicy: Array<Record<string, unknown>>;
    };
    assert.equal(body.ok, true);
    // Execution preview still works
    assert.ok(Array.isArray(body.preview));
    assert.ok(body.preview.length > 0);
    // Quality preview is separate
    assert.ok(Array.isArray(body.previewQualityPolicy), "previewQualityPolicy must be an array");
    assert.ok(body.previewQualityPolicy.length >= 1, "quality preview must include at least mode");

    // Mode row
    const modeRow = body.previewQualityPolicy.find((r) => r.field === "mode");
    assert.ok(modeRow, "quality preview must include mode");
    assert.equal(modeRow!.value, "warn");
    assert.equal(modeRow!.source, "worker");
    assert.equal(modeRow!.layer, "quality");

    // maxFiles = null → worker-owned unlimited
    const maxFilesRow = body.previewQualityPolicy.find((r) => r.field === "maxFiles");
    assert.ok(maxFilesRow);
    assert.equal(maxFilesRow!.value, null);
    assert.equal(maxFilesRow!.source, "worker");

    // minScenarios = 0 → worker-owned explicit zero
    const minScenariosRow = body.previewQualityPolicy.find((r) => r.field === "minScenarios");
    assert.ok(minScenariosRow);
    assert.equal(minScenariosRow!.value, 0);
    assert.equal(minScenariosRow!.source, "worker");

    // Unspecified fields default to global
    const minCallChainRow = body.previewQualityPolicy.find((r) => r.field === "minCallChainSteps");
    assert.ok(minCallChainRow);
    assert.equal(minCallChainRow!.source, "global");
  } finally {
    await ctx.cleanup();
  }
});

test("Hub worker preview inherits global Quality when no override is provided", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
    });
    assert.equal(res.status, 200);
    const body = res.body as { previewQualityPolicy: Array<Record<string, unknown>> };
    // All rows should be global-sourced
    const rows = body.previewQualityPolicy || [];
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.equal(row.source, "global", `${row.field} should be global when no override`);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("Hub worker preview rejects invalid Quality values", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;

    // Unknown field
    const unknown = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftContractQuality: { notAField: 42 },
    });
    assert.equal(unknown.status, 422);

    // Bad mode
    const badMode = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftContractQuality: { mode: "super-hard" },
    });
    assert.equal(badMode.status, 422);

    // Negative minimum
    const negMin = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftContractQuality: { minScenarios: -1 },
    });
    assert.equal(negMin.status, 422);

    // Zero maximum
    const zeroMax = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftContractQuality: { maxFiles: 0 },
    });
    assert.equal(zeroMax.status, 422);

    // Malformed object
    const malformed = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftContractQuality: "not-an-object",
    });
    assert.equal(malformed.status, 422);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub worker preview merges existing and draft Quality overrides", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      existingContractQuality: { mode: "warn", maxFiles: null },
      draftContractQuality: { maxFiles: 5, minScenarios: 0 },
    });
    assert.equal(res.status, 200);
    const body = res.body as { previewQualityPolicy: Array<Record<string, unknown>> };

    // mode: from existing (not overridden by draft)
    const modeRow = body.previewQualityPolicy.find((r) => r.field === "mode");
    assert.equal(modeRow!.value, "warn");

    // maxFiles: draft overrides existing
    const maxFilesRow = body.previewQualityPolicy.find((r) => r.field === "maxFiles");
    assert.equal(maxFilesRow!.value, 5);
    assert.equal(maxFilesRow!.source, "worker");

    // minScenarios: from draft only
    const minScenariosRow = body.previewQualityPolicy.find((r) => r.field === "minScenarios");
    assert.equal(minScenariosRow!.value, 0);
    assert.equal(minScenariosRow!.source, "worker");
  } finally {
    await ctx.cleanup();
  }
});

test("Worker Profile round-trips contractQuality through save and reload", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;

    // Save a worker with explicit Quality overrides
    const save = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "cq-worker",
        label: "Quality Worker",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        contractQuality: {
          mode: "warn",
          maxFiles: null,
          maxDiffLines: null,
          maxFocusPaths: null,
          minScenarios: 0,
        },
      },
    });
    assert.equal(save.status, 200);
    const saved = (save.body as {
      workerProfiles: { profiles: Array<{ id: string; contractQuality?: Record<string, unknown> }> };
    }).workerProfiles;
    const savedProfile = saved.profiles.find((p) => p.id === "cq-worker");
    assert.ok(savedProfile, "profile was saved");
    assert.ok(savedProfile!.contractQuality, "contractQuality was persisted");
    const cq = savedProfile!.contractQuality!;
    assert.equal(cq.mode, "warn");
    assert.equal(cq.maxFiles, null, "explicit null maxFiles preserved");
    assert.equal(cq.maxDiffLines, null);
    assert.equal(cq.maxFocusPaths, null);
    assert.equal(cq.minScenarios, 0, "explicit zero minScenarios preserved");

    // Reload via GET
    const get = await doHttp(`${base}/api/worker-profiles`, "GET", ctx.token);
    assert.equal(get.status, 200);
    const loaded = (get.body as {
      workerProfiles: { profiles: Array<{ id: string; contractQuality?: Record<string, unknown> }> };
    }).workerProfiles;
    const loadedProfile = loaded.profiles.find((p) => p.id === "cq-worker");
    assert.ok(loadedProfile);
    assert.ok(loadedProfile!.contractQuality, "contractQuality survives get/load cycle");
    assert.equal(loadedProfile!.contractQuality!.mode, "warn");
    assert.equal(loadedProfile!.contractQuality!.maxFiles, null);

    // Edit: change only mode, keep other overrides
    const edit = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "cq-worker",
        label: "Quality Worker v2",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        contractQuality: {
          mode: "hard",
          maxFiles: null,
          maxDiffLines: null,
          maxFocusPaths: null,
          minScenarios: 0,
        },
      },
    });
    assert.equal(edit.status, 200);
    const edited = (edit.body as {
      workerProfiles: { profiles: Array<{ id: string; contractQuality?: Record<string, unknown> }> };
    }).workerProfiles;
    const editedProfile = edited.profiles.find((p) => p.id === "cq-worker");
    assert.equal(editedProfile!.contractQuality!.mode, "hard");
    assert.equal(editedProfile!.contractQuality!.maxFiles, null, "null stays after edit");

    // Verify settings-level persistence
    const reloaded = ctx.settings.get();
    const storedProfile = reloaded.workerProfiles.profiles.find((p) => p.id === "cq-worker");
    assert.ok(storedProfile);
    assert.ok(storedProfile!.contractQuality);
    assert.equal(storedProfile!.contractQuality!.mode, "hard");
    assert.equal(storedProfile!.contractQuality!.maxFiles, null);
  } finally {
    await ctx.cleanup();
  }
});

test("Worker without Quality override preserves unrelated fields through edit", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;

    // Save a worker without contractQuality
    const save = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "no-cq",
        label: "No Quality Worker",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        effort: "high",
        maxBudgetUsd: 0.5,
      },
    });
    assert.equal(save.status, 200);

    // Edit with an advancedPolicy but no contractQuality
    const edit = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "no-cq",
        label: "No Quality Worker v2",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        effort: "high",
        maxBudgetUsd: 0.5,
        advancedPolicy: { maxConcurrency: 2 },
      },
    });
    assert.equal(edit.status, 200);
    const edited = (edit.body as {
      workerProfiles: { profiles: Array<{ id: string; effort?: string; maxBudgetUsd?: number; contractQuality?: unknown; advancedPolicy?: Record<string, unknown> }> };
    }).workerProfiles;
    const profile = edited.profiles.find((p) => p.id === "no-cq");
    assert.ok(profile);
    assert.equal(profile!.effort, "high", "effort preserved");
    assert.equal(profile!.maxBudgetUsd, 0.5, "budget preserved");
    assert.equal(profile!.contractQuality, undefined, "no guessed quality override");
    assert.equal(profile!.advancedPolicy!.maxConcurrency, 2);
  } finally {
    await ctx.cleanup();
  }
});

test("Quality and execution fields stay distinct in preview response", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      existingAdvancedPolicy: { fileLimit: 10, changedLineLimit: 500 },
      existingContractQuality: { maxFiles: 6, maxDiffLines: 200 },
    });
    assert.equal(res.status, 200);
    const body = res.body as {
      preview: Array<Record<string, unknown>>;
      previewQualityPolicy: Array<Record<string, unknown>>;
    };

    // Execution preview has fileLimit — from advanced policy
    const execFileRow = body.preview.find((r) => r.field === "fileLimit");
    assert.ok(execFileRow, "execution preview includes fileLimit");
    assert.equal(execFileRow!.value, 10);

    // Quality preview has maxFiles — from contract quality
    const qualFileRow = body.previewQualityPolicy.find((r) => r.field === "maxFiles");
    assert.ok(qualFileRow, "quality preview includes maxFiles");
    assert.equal(qualFileRow!.value, 6);

    // Quality rows never mention enforcementPhase (that's execution-only)
    for (const row of body.previewQualityPolicy) {
      assert.equal(row.enforcementPhase, undefined, "quality row must not have enforcementPhase");
    }
    // Execution rows never mention "quality" layer
    for (const row of body.preview) {
      assert.notEqual(row.layer, "quality");
    }
  } finally {
    await ctx.cleanup();
  }
});

// --- UI asset tests ---

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Hub app.js carries Quality builder, collector, and hydration functions", async () => {
  const src = await readFile(path.join(root, "src", "hub", "public", "app.js"), "utf8");
  assert.ok(src.includes("function buildQualityFields"), "quality field builder exists");
  assert.ok(src.includes("function collectQualityPatch"), "quality collector exists");
  assert.ok(src.includes("function hydrateQualityFields"), "quality hydrator exists");
  assert.ok(src.includes("function renderQualityPreview"), "quality preview renderer exists");
  assert.ok(src.includes("previewQualityPolicy"), "previewQualityPolicy key read from response");
  assert.ok(src.includes('"data-quality"'), "quality field data attributes");
  assert.ok(src.includes("QUALITY_FIELD_LABELS"), "quality field labels constant");
  assert.ok(src.includes("QUALITY_MAX_FIELDS"), "quality max field inventory");
  assert.ok(src.includes("QUALITY_MIN_FIELDS"), "quality min field inventory");
  assert.ok(src.includes("QUALITY_MODE_OPTIONS"), "quality mode options constant");
  assert.ok(src.includes("collectQualityPatch()"), "collect quality in save flow");
  assert.ok(src.includes("data-quality-max-mode"), "maximum fields have inherit/unlimited/limited state");
  assert.ok(src.includes("data-quality-max-value"), "limited maximums have a separate numeric value");
  assert.ok(src.includes('fl-quality-preview'), "quality preview panel id");
  assert.ok(src.includes("quality-disclosure"), "quality disclosure CSS class");
  // Quality and execution are visibly separate
  assert.ok(src.includes('t("workersQualityGroup")'), "quality section title uses i18n");
  assert.ok(src.includes('t("workersQualityGroupHint")'), "quality layer explanation uses i18n");
  // Quality summary on worker cards
  assert.ok(src.includes("workersQualitySummaryOn"), "quality summary on label");
  assert.ok(src.includes("workersQualitySummaryOff"), "quality summary off/inherit label");
});

test("Hub i18n carries Quality keys in both languages", async () => {
  const i18n = await readFile(path.join(root, "src", "hub", "public", "i18n.js"), "utf8");
  for (const key of [
    "workersQualityGroup",
    "workersQualityGroupHint",
    "workersQualityGroupOpen",
    "workersQualityMode",
    "workersQualityInherit",
    "workersQualityUnlimited",
    "workersQualityLimited",
    "workersQualityLimitValue",
    "workersQualityModeHard",
    "workersQualityModeWarn",
    "workersQualityModeScore",
    "workersQualityModeOff",
    "workersQualityMaxFiles",
    "workersQualityMaxDiffLines",
    "workersQualityMaxFocusPaths",
    "workersQualityMinScenarios",
    "workersQualityMinCallChainSteps",
    "workersQualityMinOutcomeCharacters",
    "workersQualityMinModuleResponsibilityCharacters",
    "workersQualityPreviewTitle",
    "workersQualitySummaryOn",
    "workersQualitySummaryOff",
  ]) {
    assert.ok(i18n.includes(key + ":"), `en ${key} present`);
  }
  // Chinese copy must be real, not English fallback
  assert.ok(i18n.includes("任务说明质量"), "zh quality group title");
  assert.ok(i18n.includes("说明质量：沿用全局设置"), "zh quality summary off");
  // Layer explanation: this checks description quality, not output limits
  assert.match(i18n, /workersQualityGroupHint['"]?\s*:\s*"[^"]*not how many files/i);
  assert.match(i18n, /workersQualityGroupHint['"]?\s*:\s*"[^"]*不限制 Worker/i);
  // Max fields describe the Task's declared scope, not Worker runtime output.
  assert.match(i18n, /workersQualityMaxFiles['"]?\s*:\s*"[^"]*Task description/i);
  assert.match(i18n, /workersQualityMaxFiles['"]?\s*:\s*"[^"]*任务说明/i);
});

test("Hub Quality preview columns omit enforcement phase from quality rows", async () => {
  const src = await readFile(path.join(root, "src", "hub", "public", "app.js"), "utf8");
  // renderQualityPreview must NOT include an enforcement column
  const renderStart = src.indexOf("function renderQualityPreview");
  const renderEnd = src.indexOf("function ", renderStart + 1);
  const renderBlock = src.slice(renderStart, renderEnd > 0 ? renderEnd : src.length);
  // Only three columns: setting, value, source — no enforcement
  const thCount = (renderBlock.match(/h\("th"/g) || []).length;
  assert.equal(thCount, 3, "quality preview must have exactly 3 columns (setting, value, source)");
  assert.ok(!renderBlock.includes("workersPreviewEnforce"), "quality preview has no enforcement column");
  assert.ok(!renderBlock.includes("enforcementPhase"), "quality preview never references enforcementPhase");
});

test("Hub worker save includes contractQuality in profile payload without erasing other fields", async () => {
  const src = await readFile(path.join(root, "src", "hub", "public", "app.js"), "utf8");
  // Save flow includes contractQuality
  assert.ok(src.includes("profile.contractQuality = qualityPatch"), "qualityPatch assigned to profile");
  assert.ok(src.includes("editingProfile.contractQuality"), "edit flow preserves existing quality");
  // Other fields are not erased
  assert.ok(src.includes("profile.advancedPolicy"), "advanced policy still assigned");
  assert.ok(src.includes("profile.pricingRoute"), "pricing route still assigned");
});

test("Hub Quality and execution preview are separate DOM panels", async () => {
  const src = await readFile(path.join(root, "src", "hub", "public", "app.js"), "utf8");
  // Separate preview panel ids
  assert.ok(src.includes('previewPanel.id = "fl-worker-preview"'), "execution preview panel id");
  assert.ok(src.includes('qualPreviewPanel.id = "fl-quality-preview"'), "quality preview panel id");
  // Separate render functions
  assert.ok(src.includes("function renderWorkerPreview"));
  assert.ok(src.includes("function renderQualityPreview"));
});

test("Hub Quality form can return every override to global inheritance", async () => {
  const src = await readFile(path.join(root, "src", "hub", "public", "app.js"), "utf8");
  const collectStart = src.indexOf("function collectQualityPatch");
  const collectEnd = src.indexOf("function syncQualityMaximumInput", collectStart);
  const collectBlock = src.slice(collectStart, collectEnd);
  assert.ok(src.includes('["", "workersQualityInherit"]'), "mode offers global inheritance");
  assert.ok(src.includes('["inherit", "workersQualityInherit"]'), "maximums offer global inheritance");
  assert.ok(src.includes('["unlimited", "workersQualityUnlimited"]'), "maximums distinguish unlimited");
  assert.ok(src.includes('["limited", "workersQualityLimited"]'), "maximums distinguish a numeric limit");
  assert.ok(collectBlock.includes('state.value === "inherit"'), "inherited maximums are omitted");
  assert.ok(collectBlock.includes('state.value === "unlimited"'), "unlimited maximums persist null");

  const fetchStart = src.indexOf("function fetchWorkerPreview");
  const fetchEnd = src.indexOf("function renderWorkerPreview", fetchStart);
  const fetchBlock = src.slice(fetchStart, fetchEnd);
  assert.ok(!fetchBlock.includes("existingContractQuality"),
    "the hydrated full draft can remove an old override instead of merging it back");

  const saveStart = src.indexOf('form.addEventListener("submit"', src.indexOf("function rWorker"));
  const saveEnd = src.indexOf('advDetails.addEventListener("toggle"', saveStart);
  const saveBlock = src.slice(saveStart, saveEnd);
  assert.ok(!saveBlock.includes("else if(isEdit && editingProfile.contractQuality)"),
    "saving an empty Quality object removes all Worker overrides");
});

test("Hub worker preview endpoint returns both prestine and quality policy", async () => {
  const serverSrc = await readFile(path.join(root, "src", "hub", "server.ts"), "utf8");
  // The extended preview endpoint processes both policy types
  assert.ok(serverSrc.includes("previewQualityPolicy"), "preview response key is exported");
  assert.ok(serverSrc.includes("existingContractQuality"), "existing quality accepted");
  assert.ok(serverSrc.includes("draftContractQuality"), "draft quality accepted");
  assert.ok(serverSrc.includes("validateContractQualityOverride"), "shared validator imported");
  assert.ok(serverSrc.includes("previewQualityPolicy"), "shared resolver called");
  // Quality preview is returned separately from execution preview
  assert.ok(serverSrc.includes("previewQualityPolicy: qualityPreview"), "quality rows returned under separate key");
});
