import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { isWorkerProfileId } from "../core/worker-profiles.js";

const SAMPLE_ID = /^sample_[a-f0-9]{32}$/;
const MARKER_NAME = "sample.json";
const TASK_NAME = "task.yaml";
const SUBMIT_LOCK = "submit.lock";
const MAX_FIXTURE_FILE_BYTES = 64 * 1024;
const MAX_MARKER_BYTES = 8 * 1024;
const FIXTURE_FILES = Object.freeze([
  "checkout.py",
  "README.md",
  "tests/test_checkout.py",
]);

export type OnboardingSampleState = "prepared" | "submitting" | "submitted";

interface StoredSample {
  version: 1;
  sampleId: string;
  workerProfileId: string;
  state: OnboardingSampleState;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
}

export interface OnboardingSampleView {
  sampleId: string;
  workerProfileId: string;
  state: OnboardingSampleState;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
}

export interface PreparedOnboardingSample extends OnboardingSampleView {
  taskFile: string;
}

export interface OnboardingSampleSubmissionLease {
  sample: PreparedOnboardingSample;
  alreadySubmitted: boolean;
  commit(taskId: string): Promise<OnboardingSampleView>;
  abort(): Promise<void>;
}

function isCanonicalIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function parseMarker(raw: string, expectedId: string): StoredSample {
  if (Buffer.byteLength(raw) > MAX_MARKER_BYTES) throw new Error("Sample evidence is invalid");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Sample evidence is invalid"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sample evidence is invalid");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  const required = ["createdAt", "sampleId", "state", "updatedAt", "version", "workerProfileId"];
  const withTask = [...required, "taskId"].sort();
  if (JSON.stringify(keys) !== JSON.stringify(required.sort())
    && JSON.stringify(keys) !== JSON.stringify(withTask)) {
    throw new Error("Sample evidence is invalid");
  }
  if (row.version !== 1 || row.sampleId !== expectedId || !SAMPLE_ID.test(expectedId)) {
    throw new Error("Sample evidence is invalid");
  }
  if (typeof row.workerProfileId !== "string" || !isWorkerProfileId(row.workerProfileId)) {
    throw new Error("Sample evidence is invalid");
  }
  if (row.state !== "prepared" && row.state !== "submitting" && row.state !== "submitted") {
    throw new Error("Sample evidence is invalid");
  }
  if (!isCanonicalIso(row.createdAt) || !isCanonicalIso(row.updatedAt)) {
    throw new Error("Sample evidence is invalid");
  }
  if (row.state === "submitted") {
    if (typeof row.taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.taskId)) {
      throw new Error("Sample evidence is invalid");
    }
  } else if (row.taskId !== undefined) {
    throw new Error("Sample evidence is invalid");
  }
  return row as unknown as StoredSample;
}

function view(row: StoredSample): OnboardingSampleView {
  return Object.freeze({
    sampleId: row.sampleId,
    workerProfileId: row.workerProfileId,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.taskId === undefined ? {} : { taskId: row.taskId }),
  });
}

function generatedTask(workerProfileId: string): string {
  return YAML.stringify({
    version: 2,
    name: "Fix the checkout loyalty calculation",
    project: "./project",
    taskClass: "forklight-guided-checkout",
    workerProfileId,
    contract: {
      outcome: "Loyalty credit reduces the taxable subtotal before tax while existing validation and function inputs remain compatible.",
      presentation: {
        summary: "修复结账示例中的积分抵扣顺序，并由独立测试确认结果。",
        language: "zh-CN",
      },
      context: [
        "This is ForkLight's packaged disposable checkout sample.",
        "The current implementation subtracts loyalty credit after tax.",
      ],
      inScope: [
        "Correct the loyalty-credit and tax calculation in checkout.py.",
        "Preserve the public function signature and validation behavior.",
      ],
      outOfScope: [
        "Do not add dependencies, redesign the API, or edit files outside this disposable sample.",
      ],
      executionSteps: [
        "Read checkout.py and the packaged tests.",
        "Make the smallest behavior fix that applies loyalty credit before tax.",
        "Run the packaged unittest suite and report the result.",
      ],
      deliverables: [
        "Corrected checkout calculation and a passing packaged unittest suite.",
      ],
      modules: [{
        name: "Checkout calculation",
        responsibility: "Calculate discounts, taxable subtotal, tax, and final non-negative total.",
        consumes: ["subtotal, coupon percentage, loyalty credit, and tax rate"],
        produces: ["validated final total in cents"],
        boundaries: ["checkout.py and its packaged tests only"],
      }],
      callChain: [
        "The test calls calculate_total with checkout inputs.",
        "calculate_total validates inputs and derives the taxable subtotal.",
        "Tax is applied and the final non-negative total is returned.",
        "The unittest suite independently compares returned totals with expected behavior.",
      ],
      scenarios: [
        {
          name: "Loyalty credit before tax",
          given: "A subtotal of 1000 cents, 200 cents loyalty credit, and 10% tax.",
          when: "The checkout total is calculated.",
          then: "The result is 880 cents because tax applies to 800 cents.",
        },
        {
          name: "Validation stays intact",
          given: "A negative subtotal or coupon above 100%.",
          when: "The checkout total is calculated.",
          then: "The existing ValueError behavior is preserved.",
        },
      ],
      risks: [
        "Moving only the final subtraction would preserve the bug; the taxable subtotal must include both discounts.",
      ],
      changeBudget: { maxFiles: 2, maxDiffLines: 60 },
    },
    workspace: { exclude: [".git", "__pycache__"] },
    worker: {
      allowEdits: true,
      allowedCommands: [],
      focusPaths: ["checkout.py", "tests/test_checkout.py"],
    },
    acceptance: {
      criteria: [
        "Loyalty credit reduces taxable subtotal before tax.",
        "Coupon, non-negative clamping, validation, and the function signature remain compatible.",
      ],
      commands: ["python3 -m unittest discover -s tests"],
    },
  }, { lineWidth: 100 });
}

async function writePrivateJson(file: string, row: StoredSample): Promise<void> {
  const temp = `${file}.tmp-${randomBytes(8).toString("hex")}`;
  await writeFile(temp, `${JSON.stringify(row)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temp, file);
  await chmod(file, 0o600);
}

export class OnboardingSampleService {
  constructor(
    private readonly packageRoot: string,
    private readonly sampleRoot: string,
    private readonly makeId: () => string = () => `sample_${randomBytes(16).toString("hex")}`,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private sampleDir(sampleId: string): string {
    if (!SAMPLE_ID.test(sampleId)) throw new Error("Sample reference is invalid");
    return path.join(this.sampleRoot, sampleId);
  }

  private async readStored(sampleId: string): Promise<StoredSample> {
    const dir = this.sampleDir(sampleId);
    const dirInfo = await lstat(dir);
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new Error("Sample evidence is invalid");
    const marker = path.join(dir, MARKER_NAME);
    const info = await lstat(marker);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKER_BYTES) {
      throw new Error("Sample evidence is invalid");
    }
    return parseMarker(await readFile(marker, "utf8"), sampleId);
  }

  async prepare(workerProfileId: string): Promise<PreparedOnboardingSample> {
    if (!isWorkerProfileId(workerProfileId)) throw new Error("Worker selection is invalid");
    const sampleId = this.makeId();
    if (!SAMPLE_ID.test(sampleId)) throw new Error("Sample reference is invalid");
    await mkdir(this.sampleRoot, { recursive: true, mode: 0o700 });
    await chmod(this.sampleRoot, 0o700);

    const packageReal = await realpath(this.packageRoot);
    const fixture = path.join(packageReal, "fixtures", "checkout");
    const fixtureReal = await realpath(fixture);
    if (fixtureReal !== fixture || !fixtureReal.startsWith(`${packageReal}${path.sep}`)) {
      throw new Error("Packaged sample is unavailable or unsafe; reinstall or update ForkLight");
    }

    const temp = path.join(this.sampleRoot, `.creating-${sampleId}`);
    const finalDir = this.sampleDir(sampleId);
    await mkdir(temp, { mode: 0o700 });
    try {
      const projectDir = path.join(temp, "project");
      await mkdir(path.join(projectDir, "tests"), { recursive: true, mode: 0o700 });
      for (const relative of FIXTURE_FILES) {
        const source = path.join(fixtureReal, ...relative.split("/"));
        const before = await lstat(source);
        if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FIXTURE_FILE_BYTES) {
          throw new Error("Packaged sample is unavailable or unsafe; reinstall or update ForkLight");
        }
        const sourceReal = await realpath(source);
        if (!sourceReal.startsWith(`${fixtureReal}${path.sep}`)) {
          throw new Error("Packaged sample is unavailable or unsafe; reinstall or update ForkLight");
        }
        const content = await readFile(source);
        const after = await lstat(source);
        if (before.dev !== after.dev || before.ino !== after.ino
          || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
          throw new Error("Packaged sample changed during preparation; reinstall or update ForkLight");
        }
        const target = path.join(projectDir, ...relative.split("/"));
        await writeFile(target, content, { mode: 0o600, flag: "wx" });
      }
      const taskFile = path.join(temp, TASK_NAME);
      await writeFile(taskFile, generatedTask(workerProfileId), { mode: 0o600, flag: "wx" });
      const timestamp = this.now().toISOString();
      await writePrivateJson(path.join(temp, MARKER_NAME), {
        version: 1,
        sampleId,
        workerProfileId,
        state: "prepared",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await rename(temp, finalDir);
      const stored = await this.readStored(sampleId);
      return Object.freeze({ ...view(stored), taskFile: path.join(finalDir, TASK_NAME) });
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
  }

  async get(sampleId: string): Promise<PreparedOnboardingSample> {
    const stored = await this.readStored(sampleId);
    return Object.freeze({ ...view(stored), taskFile: path.join(this.sampleDir(sampleId), TASK_NAME) });
  }

  async latest(): Promise<PreparedOnboardingSample | undefined> {
    try {
      const entries = await readdir(this.sampleRoot, { withFileTypes: true });
      const candidates: PreparedOnboardingSample[] = [];
      for (const entry of entries.slice(0, 200)) {
        if (!entry.isDirectory() || !SAMPLE_ID.test(entry.name)) continue;
        try { candidates.push(await this.get(entry.name)); } catch { /* unsafe/incomplete entries are ignored */ }
      }
      candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return candidates[0];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async acquireSubmission(sampleId: string): Promise<OnboardingSampleSubmissionLease> {
    const dir = this.sampleDir(sampleId);
    const lockPath = path.join(dir, SUBMIT_LOCK);
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("This sample start is already being handled");
      }
      throw error;
    }
    let settled = false;
    try {
      const current = await this.readStored(sampleId);
      if (current.state === "submitted") {
        settled = true;
        await lock.close();
        await unlink(lockPath).catch(() => undefined);
        const sample = Object.freeze({ ...view(current), taskFile: path.join(dir, TASK_NAME) });
        return {
          sample,
          alreadySubmitted: true,
          commit: async () => view(current),
          abort: async () => undefined,
        };
      }
      if (current.state === "submitting") {
        throw new Error("The previous sample start has an unknown outcome; inspect the Board before trying again");
      }
      const startedAt = this.now().toISOString();
      const submitting: StoredSample = { ...current, state: "submitting", updatedAt: startedAt };
      await writePrivateJson(path.join(dir, MARKER_NAME), submitting);
      const sample = Object.freeze({ ...view(submitting), taskFile: path.join(dir, TASK_NAME) });
      return {
        sample,
        alreadySubmitted: false,
        commit: async (taskId: string) => {
          if (settled) throw new Error("Sample submission is already settled");
          if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(taskId)) {
            throw new Error("Task result is invalid");
          }
          const completed: StoredSample = {
            ...submitting,
            state: "submitted",
            taskId,
            updatedAt: this.now().toISOString(),
          };
          await writePrivateJson(path.join(dir, MARKER_NAME), completed);
          settled = true;
          await lock.close();
          await unlink(lockPath).catch(() => undefined);
          return view(completed);
        },
        abort: async () => {
          if (settled) return;
          await writePrivateJson(path.join(dir, MARKER_NAME), {
            ...current,
            state: "prepared",
            updatedAt: this.now().toISOString(),
          });
          settled = true;
          await lock.close();
          await unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (error) {
      if (!settled) {
        await lock.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      }
      throw error;
    }
  }
}
