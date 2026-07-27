import assert from "node:assert/strict";
import test from "node:test";
import {
  isCanonicalAbsolutePath, isDeliveryProfileId,
  validateDeliveryProfile, validateDeliveryProfilesSettings,
  getDeliveryProfile, listDeliveryProfiles, selectDeliveryProfile,
  buildDeliveryPlanView,
} from "../src/core/delivery-profiles.js";

const pa = { id:"default", label:"Default", buildCommands:["npm ci"], activationCommands:["npm run build"], activationCheckCommands:["npm test"] };
const pb = { id:"bound", label:"Bound", buildCommands:["yarn install"], activationCommands:[], activationCheckCommands:[] };
const vs = { defaultProfileId:"default", profiles:[pa,pb], projectBindings:{"/home/user/repo":"bound"} };

// canonical paths — rejects padded, relative, dot-segment, duplicate-separator, non-root trailing-separator
test("canonical path boundary", () => {
  for (const v of ["/","/a","/foo/bar","/x/y/z"]) assert.ok(isCanonicalAbsolutePath(v));
  for (const v of ["","foo"," /foo","/foo ","./foo","../foo","/a/../b","/a/./b","/a//b","/a/"])
    assert.ok(!isCanonicalAbsolutePath(v));
});

// strict field allowlists + id pattern + default reference
test("strict fields, ids, and defaults", () => {
  assert.ok(isDeliveryProfileId("default"));
  assert.ok(!isDeliveryProfileId("Default"));
  assert.throws(()=>validateDeliveryProfile({...pa,extra:1}),/unsupported field "extra"/);
  assert.throws(()=>validateDeliveryProfilesSettings({...vs,extra:1}),/unsupported field "extra"/);
  assert.throws(()=>validateDeliveryProfilesSettings({defaultProfileId:"no",profiles:[pa],projectBindings:{}}),/defaultProfileId must reference/);
});

// command privacy — error names field/index never content
test("command privacy", () => {
  assert.throws(()=>validateDeliveryProfile({...pa,buildCommands:["curl https://x.com?t=sekret",""]}),
    (e:Error)=>!e.message.includes("sekret")&&!e.message.includes("x.com")&&e.message.includes("buildCommands[1]"));
});

// command limits — max 16 per list, non-empty strings
test("command limits", () => {
  const c17 = Array.from({length:17},(_,i)=>`cmd${i}`);
  assert.throws(()=>validateDeliveryProfile({...pa,buildCommands:c17}),/at most 16/);
  assert.throws(()=>validateDeliveryProfile({...pa,buildCommands:["","ok"]}),/buildCommands\[0\]/);
});

// uniqueness + projectBindings validation
test("duplicate ids and invalid projectBindings rejected", () => {
  assert.throws(()=>validateDeliveryProfilesSettings({defaultProfileId:"default",profiles:[pa,{...pa}],projectBindings:{}}),/duplicate profile id/);
  // non-canonical binding key
  assert.throws(()=>validateDeliveryProfilesSettings({defaultProfileId:"default",profiles:[pa,pb],projectBindings:{"rel":"bound"}}),/projectBindings key/);
  // binding value not an existing profile id
  assert.throws(()=>validateDeliveryProfilesSettings({defaultProfileId:"default",profiles:[pa],projectBindings:{"/x":"no-such"}}),/projectBindings value/);
  // binding value not a string
  assert.throws(()=>validateDeliveryProfilesSettings({defaultProfileId:"default",profiles:[pa],projectBindings:{"/x":1}}),/projectBindings value/);
});

// empty registry is valid
test("empty registry is valid", () => {
  const s = validateDeliveryProfilesSettings({defaultProfileId:null,profiles:[],projectBindings:{}});
  assert.equal(s.defaultProfileId, null);
  assert.equal(s.profiles.length, 0);
  assert.equal(Object.keys(s.projectBindings).length, 0);
  assert.equal(selectDeliveryProfile(s,"/any/path"), null);
});

// explicit-project-default precedence
test("selection precedence: explicit > project > default > null", () => {
  const s = validateDeliveryProfilesSettings(vs);
  assert.equal(selectDeliveryProfile(s,"/home/user/repo","bound")?.provenance,"explicit");
  assert.equal(selectDeliveryProfile(s,"/home/user/repo","bound")?.profile.id,"bound");
  assert.equal(selectDeliveryProfile(s,"/home/user/repo")?.provenance,"project");
  assert.equal(selectDeliveryProfile(s,"/home/user/repo")?.profile.id,"bound");
  assert.equal(selectDeliveryProfile(s,"/other/path")?.provenance,"default");
  assert.equal(selectDeliveryProfile(s,"/other/path")?.profile.id,"default");
  // explicit wins over project binding
  assert.equal(selectDeliveryProfile(s,"/home/user/repo","default")?.provenance,"explicit");
});

// explicit missing or malformed fails closed — no fallback
test("explicit fail-closed, no fallback", () => {
  const s = validateDeliveryProfilesSettings(vs);
  assert.throws(()=>selectDeliveryProfile(s,"/home/user/repo","BadId"),/malformed/);
  assert.throws(()=>selectDeliveryProfile(s,"/home/user/repo",""),/malformed/);
  assert.throws(()=>selectDeliveryProfile(s,"/home/user/repo","no-such"),/not found/);
});

// detachment: mutating caller-owned input arrays does not affect validated results
test("detached return values via input mutation", () => {
  // validateDeliveryProfile copies input arrays
  const c1 = ["npm ci"];
  const r1 = validateDeliveryProfile({id:"d",label:"D",buildCommands:c1,activationCommands:[],activationCheckCommands:[]});
  c1.push("evil");
  assert.deepStrictEqual(r1.buildCommands, ["npm ci"]);

  // get/list/select all detach from validated settings
  const c2 = ["npm ci"];
  const s = validateDeliveryProfilesSettings({defaultProfileId:"d",profiles:[{id:"d",label:"D",buildCommands:c2,activationCommands:[],activationCheckCommands:[]}],projectBindings:{}});
  c2.push("evil");
  assert.deepStrictEqual(getDeliveryProfile(s,"d").buildCommands, ["npm ci"]);
  assert.deepStrictEqual(listDeliveryProfiles(s)[0]!.buildCommands, ["npm ci"]);
  assert.deepStrictEqual(selectDeliveryProfile(s,"/x")!.profile.buildCommands, ["npm ci"]);
});

// command order preserved
test("command order preserved", () => {
  const p = { id:"o", label:"O", buildCommands:["a","b","c"], activationCommands:[], activationCheckCommands:[] };
  const s = validateDeliveryProfilesSettings({defaultProfileId:"o",profiles:[p],projectBindings:{}});
  assert.deepStrictEqual(selectDeliveryProfile(s,"/x")!.profile.buildCommands,["a","b","c"]);
  assert.deepStrictEqual(getDeliveryProfile(s,"o").buildCommands,["a","b","c"]);
});

// no selection when no match and null default
test("null when no match and null default", () => {
  const s = validateDeliveryProfilesSettings({defaultProfileId:null,profiles:[pb],projectBindings:{"/home/user/repo":"bound"}});
  assert.equal(selectDeliveryProfile(s,"/unmatched/path"), null);
});

// --- buildDeliveryPlanView ---

test("plan for source-only task with inline delivery", () => {
  const plan = buildDeliveryPlanView(
    { buildCommands: [], activationCommands: [], activationCheckCommands: [] },
    { source: "inline" },
  );
  assert.equal(plan.resolutionSource, "inline");
  assert.equal(plan.profileId, undefined);
  assert.equal(plan.buildCommandCount, 0);
  assert.equal(plan.activationCommandCount, 0);
  assert.equal(plan.activationCheckCommandCount, 0);
  assert.equal(plan.outcome, "source-only");
  assert.deepStrictEqual(plan.stages, {
    sourceApply: "required",
    sourceVerify: "required",
    artifactBuild: "not-configured",
    runtimeActivation: "not-configured",
  });
});

test("plan for project-bound build and activation", () => {
  const plan = buildDeliveryPlanView(
    { buildCommands: ["npm ci"], activationCommands: ["npm start", "npx pm2 start"], activationCheckCommands: ["curl localhost:3000"] },
    { source: "project", profileId: "bound" },
  );
  assert.equal(plan.resolutionSource, "project");
  assert.equal(plan.profileId, "bound");
  assert.equal(plan.buildCommandCount, 1);
  assert.equal(plan.activationCommandCount, 2);
  assert.equal(plan.activationCheckCommandCount, 1);
  assert.equal(plan.outcome, "activation");
  assert.deepStrictEqual(plan.stages, {
    sourceApply: "required",
    sourceVerify: "required",
    artifactBuild: "required",
    runtimeActivation: "required",
  });
});

test("plan for explicit profile with build only", () => {
  const plan = buildDeliveryPlanView(
    { buildCommands: ["make build"], activationCommands: [], activationCheckCommands: [] },
    { source: "explicit", profileId: "build-pro" },
  );
  assert.equal(plan.resolutionSource, "explicit");
  assert.equal(plan.profileId, "build-pro");
  assert.equal(plan.outcome, "build");
  assert.equal(plan.stages.artifactBuild, "required");
  assert.equal(plan.stages.runtimeActivation, "not-configured");
});

test("plan for default profile with activation check only (no build)", () => {
  const plan = buildDeliveryPlanView(
    { buildCommands: [], activationCommands: [], activationCheckCommands: ["systemctl status app"] },
    { source: "default", profileId: "default" },
  );
  assert.equal(plan.resolutionSource, "default");
  assert.equal(plan.profileId, "default");
  assert.equal(plan.outcome, "activation");
  assert.equal(plan.stages.artifactBuild, "not-configured");
  assert.equal(plan.stages.runtimeActivation, "required");
});

test("plan when no delivery and no resolution (source-only, not-configured)", () => {
  const plan = buildDeliveryPlanView(undefined, undefined);
  assert.equal(plan.resolutionSource, "none");
  assert.equal(plan.profileId, undefined);
  assert.equal(plan.buildCommandCount, 0);
  assert.equal(plan.activationCommandCount, 0);
  assert.equal(plan.activationCheckCommandCount, 0);
  assert.equal(plan.outcome, "none");
  assert.deepStrictEqual(plan.stages, {
    sourceApply: "required",
    sourceVerify: "required",
    artifactBuild: "not-configured",
    runtimeActivation: "not-configured",
  });
});

test("legacy task with delivery but no resolution tracking describes as inline", () => {
  const plan = buildDeliveryPlanView(
    { buildCommands: ["npm ci"], activationCommands: ["npm start"], activationCheckCommands: [] },
    undefined,
  );
  assert.equal(plan.resolutionSource, "inline");
  assert.equal(plan.profileId, undefined);
  assert.equal(plan.outcome, "activation");
});

test("plan never exposes command text — only counts", () => {
  const plan = buildDeliveryPlanView(
    { buildCommands: ["curl https://example.com?token=secret123"], activationCommands: [], activationCheckCommands: [] },
    { source: "inline" },
  );
  assert.equal(plan.buildCommandCount, 1);
  // The plan object must not contain the word "secret" or "token" from commands
  const serialized = JSON.stringify(plan);
  assert.ok(!serialized.includes("secret123"));
  assert.ok(!serialized.includes("example.com"));
  assert.ok(!serialized.includes("token="));
});
