import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m2-grok-native-goal");
const wrapper = readFileSync(path.join(directory, "current-model-only-recovery-bootstrap.mjs"), "utf8");
const task = readFileSync(path.join(directory, "03-current-model-only-recovery.yaml"), "utf8");
const seed = readFileSync(path.join(directory, "00d99db6-429f-4786-b982-740f19581b31.patch"));
const expectedDigest = "e12f45e8d2b9daceebc1b5d53929a455e7ae0965110853b3e677960a0fd42f62";

assert.equal(createHash("sha256").update(seed).digest("hex"), expectedDigest);
assert.match(wrapper, new RegExp(expectedDigest));
assert.match(wrapper, /git", \["apply", "-p2"/);
assert.match(wrapper, /--exclude=src\/workers\/grok\.ts/);
assert.match(wrapper, /--exclude=tests\/worker-runtime\.test\.ts/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY: "1"/);
assert.match(wrapper, /GROK_GOAL: "1"/);
assert.match(wrapper, /GROK_WORKFLOWS: "1"/);
assert.match(wrapper, /argv\.push\("--deny", "Bash"\)/);
assert.match(task, /current-model-only-recovery-bootstrap\.mjs/);
assert.match(task, /baseMaxAttempts: 1/);
for (const field of [
  "maxExtraAttempts",
  "maxMainCorrections",
  "maxMainReverifications",
  "maxWorkerValidationRepairs",
  "maxAdaptationRounds",
]) {
  assert.match(task, new RegExp(`${field}: 0`));
}
assert.doesNotMatch(task, /src\/core\/storage-lifecycle\.ts/);
assert.doesNotMatch(task, /tests\/storage-lifecycle\.test\.ts/);

console.log("current-model-only recovery bootstrap policy passed");
