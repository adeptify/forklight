import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertNotRunningInsideNpmTest,
  BUNDLE_ARTIFACT_NAMES,
  BUNDLE_EVIDENCE_LIMITS,
  BundleBuilderError,
  buildBundleEvidence,
  buildIdentitiesEqual,
  classifyTarEntry,
  extractTopLevelJson,
  formatBundleFailure,
  isBundleEvidence,
  isSensitiveFilename,
  parseBundleOutputArgument,
  parseNpmPackJson,
  parseTestSummary,
  planCleanRunBundle,
  scanTarEntries,
  scrubAbsolutePaths,
} from "../src/core/clean-run-bundle.js";
import {
  buildCleanRunBundle,
  buildMinimalIsolatedEnv,
  parseJsonObject,
  type BundleBuilderHooks,
  type CommandSpec,
} from "../src/clean-run/build-clean-run-bundle.js";
import type { BuildIdentity } from "../src/core/build-identity.js";
import type { CapturedProcess } from "../src/core/process.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SAMPLE_IDENTITY: BuildIdentity = Object.freeze({
  protocolVersion: 2,
  packageVersion: "0.2.0",
  buildId: "a".repeat(64),
  builtAt: "2026-07-30T12:00:00.000Z",
  sourceRevision: "deadbeef",
  sourceDigest: "b".repeat(64),
});

const SAMPLE_SHA = "c".repeat(64);

function okProcess(stdout = "", stderr = ""): CapturedProcess {
  return {
    exitCode: 0,
    stdout,
    stderr,
    durationMs: 1,
    timedOut: false,
  };
}

function failProcess(stderr = "failed"): CapturedProcess {
  return {
    exitCode: 1,
    stdout: "",
    stderr,
    durationMs: 1,
    timedOut: false,
  };
}

test("parseBundleOutputArgument requires exactly one explicit output", () => {
  assert.equal(
    parseBundleOutputArgument(["--output", "/tmp/ForkLight-Clean-Run.demo"]),
    "/tmp/ForkLight-Clean-Run.demo",
  );
  assert.throws(
    () => parseBundleOutputArgument([]),
    (error: unknown) => error instanceof BundleBuilderError
      && error.category === "invalid-output",
  );
});

test("planCleanRunBundle refuses existing destination and bad parents", () => {
  assert.throws(
    () => planCleanRunBundle({
      outputRequest: "out-dir",
      projectRoot: root,
      stagingSuffix: "abc123",
      destinationExists: true,
    }),
    (error: unknown) => error instanceof BundleBuilderError
      && error.category === "destination-exists",
  );
  assert.throws(
    () => planCleanRunBundle({
      outputRequest: "out-dir",
      projectRoot: "/tmp/project",
      stagingSuffix: "abc123",
      destinationExists: false,
      parentDirectoryOk: false,
    }),
    (error: unknown) => error instanceof BundleBuilderError
      && error.category === "invalid-output",
  );
  const plan = planCleanRunBundle({
    outputRequest: "out-dir",
    projectRoot: "/tmp/project",
    stagingSuffix: "abc123",
    destinationExists: false,
    parentDirectoryOk: true,
  });
  assert.equal(plan.outputDirectory, path.resolve("/tmp/project", "out-dir"));
  assert.match(plan.stagingDirectory, /\.forklight-clean-run-staging\.abc123$/);
});

test("extractTopLevelJson and parseNpmPackJson handle nested and hostile JSON", () => {
  const nested = JSON.stringify([{
    id: "forklight@0.2.0",
    name: "forklight",
    version: "0.2.0",
    filename: "forklight-0.2.0.tgz",
    nested: { deep: { filename: "not-the-pack.tgz", arr: [1, { x: "}" }] } },
  }]);
  const mixed = `prepack noise\n${JSON.stringify({ diagnostic: true })}\n${nested}\ntrailing log\n`;
  const artifact = parseNpmPackJson(mixed);
  assert.equal(artifact.filename, "forklight-0.2.0.tgz");

  const health = {
    ok: true,
    identityStatus: "matched",
    clientBuildIdentity: SAMPLE_IDENTITY,
    daemonBuildIdentity: SAMPLE_IDENTITY,
  };
  const healthText = `warn: something\n${JSON.stringify(health)}\n`;
  const parsed = parseJsonObject(healthText);
  assert.equal(parsed.identityStatus, "matched");
  assert.deepEqual(parsed.daemonBuildIdentity, SAMPLE_IDENTITY);

  // Hostile: nested braces must not be truncated via lastIndexOf.
  const hostile = '{"a":{"b":{"c":1}},"filename":"forklight-0.2.0.tgz"}';
  assert.equal(
    (extractTopLevelJson(hostile) as { filename: string }).filename,
    "forklight-0.2.0.tgz",
  );

  assert.throws(
    () => parseNpmPackJson(JSON.stringify([{ filename: "../evil.tgz" }])),
    (error: unknown) => error instanceof BundleBuilderError
      && error.category === "pack-failed",
  );
});

test("parseTestSummary accepts # and ℹ forms and uses the final complete summary", () => {
  const hashForm = parseTestSummary([
    "ok 1 - something",
    "# tests 1837",
    "# pass 1837",
    "# fail 0",
  ].join("\n"));
  assert.deepEqual(hashForm, { testsPassed: 1837, testsTotal: 1837 });

  const infoForm = parseTestSummary([
    "ℹ tests 12",
    "ℹ pass 11",
    "ℹ fail 1",
    "ℹ tests 70",
    "ℹ pass 70",
    "ℹ fail 0",
  ].join("\n"));
  assert.deepEqual(infoForm, { testsPassed: 70, testsTotal: 70 });

  assert.throws(
    () => parseTestSummary("no summary here"),
    (error: unknown) => error instanceof BundleBuilderError
      && error.category === "test-summary-unavailable",
  );
  assert.throws(
    () => parseTestSummary("# tests 10\n# pass 9\n# fail 1\n"),
    (error: unknown) => error instanceof BundleBuilderError
      && error.category === "pack-failed",
  );
});

test("sensitive filename policy is closed and path-safe", () => {
  assert.equal(isSensitiveFilename(".env"), true);
  assert.equal(isSensitiveFilename("cli.js"), false);
  assert.equal(classifyTarEntry("/abs/path"), "absolute-path");
  assert.equal(classifyTarEntry("package/../etc/passwd"), "path-traversal");
  assert.equal(classifyTarEntry("package/.env"), "sensitive-filename");
  const bad = scanTarEntries(["package/a.js", "package/secrets.json"]);
  assert.equal(bad.ok, false);
  assert.equal(JSON.stringify(bad).includes("secrets.json"), false);
});

test("evidence builder exactly matches the prior schemaVersion 1 shape", () => {
  const evidence = buildBundleEvidence({
    createdAt: "2026-07-30T12:34:56.000Z",
    tarballFileName: "forklight-0.2.0.tgz",
    tarballSha256: SAMPLE_SHA,
    buildIdentity: SAMPLE_IDENTITY,
    verification: {
      prepack: { passed: true, testsPassed: 1837, testsTotal: 1837 },
      isolatedInstall: { passed: true },
      cliEntryLoad: { passed: true },
      mcpEntryLoad: { passed: true },
      installedBuildIdentityMatch: { passed: true },
      sensitiveFilenameScan: { passed: true },
      hubDaemonLifecycle: {
        passed: true,
        hubCurrent: true,
        daemonIdentityMatch: true,
        cleanShutdown: true,
      },
    },
  });

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.status, "ready-for-clean-user-run");
  assert.equal(evidence.createdAt, "2026-07-30T12:34:56.000Z");
  assert.equal(evidence.tarball.file, "forklight-0.2.0.tgz");
  assert.equal(evidence.tarball.sha256, SAMPLE_SHA);
  assert.deepEqual(evidence.verification, {
    prepack: "passed",
    testCount: 1837,
    testPassed: 1837,
    isolatedPrefixInstall: "passed",
    installedIdentityMatchesTarball: true,
    cliEntry: "passed",
    mcpEntry: "passed",
    installedHubStart: "passed",
    installedHubStatus: "current",
    installedDaemonBuildMatchesTarball: true,
    installedStackCleanShutdown: "passed",
    sensitiveFilenameScan: "passed",
  });
  assert.ok(isBundleEvidence(evidence));
  for (const line of BUNDLE_EVIDENCE_LIMITS) {
    assert.ok(evidence.limits.includes(line));
  }
  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes("/Users/"));
  assert.ok(!serialized.includes("generatedAt"));
  assert.ok(!serialized.includes("fileName"));
  assert.ok(!serialized.includes("\"checks\""));
  assert.ok(!serialized.includes("limitations"));
  assert.ok(!/"token"\s*:/.test(serialized));
});

test("build identity equality is exact and mismatch is detectable", () => {
  assert.equal(buildIdentitiesEqual(SAMPLE_IDENTITY, { ...SAMPLE_IDENTITY }), true);
  assert.equal(
    buildIdentitiesEqual(SAMPLE_IDENTITY, {
      ...SAMPLE_IDENTITY,
      buildId: "d".repeat(64),
    }),
    false,
  );
});

test("recursive pack under npm test is refused", () => {
  assert.throws(
    () => assertNotRunningInsideNpmTest({ npm_lifecycle_event: "test" }),
    (error: unknown) => error instanceof BundleBuilderError
      && error.category === "recursive-pack-refused",
  );
});

test("formatBundleFailure and scrubAbsolutePaths cover POSIX and Windows paths", () => {
  assert.match(
    formatBundleFailure(
      new BundleBuilderError("destination-exists", "output directory already exists; refuse overwrite"),
    ),
    /destination-exists/,
  );
  assert.match(
    scrubAbsolutePaths("boom at /Users/demo/secret and C:\\Users\\demo\\x"),
    /\[path\]/,
  );
  assert.ok(!scrubAbsolutePaths("err /var/folders/ab/cd/tmp").includes("/var/"));
  assert.ok(!formatBundleFailure(new Error("at \\\\server\\share\\x")).includes("server"));
});

test("minimal isolated env never forwards Provider credentials", () => {
  const env = buildMinimalIsolatedEnv({
    workDir: "/tmp/work",
    forklightHome: "/tmp/work/home",
    baseEnv: {
      PATH: "/usr/bin",
      DEEPSEEK_API_KEY: "secret-value",
      OPENAI_API_KEY: "also-secret",
      MINIMAX_API_KEY: "nope",
      LANG: "en_US.UTF-8",
    },
  });
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.MINIMAX_API_KEY, undefined);
  assert.equal(env.FORKLIGHT_HOME, "/tmp/work/home");
  assert.ok(String(env.npm_config_cache).includes("npm-cache"));
  assert.ok(String(env.HOME).includes("npm-home"));

  const packEnv = buildMinimalIsolatedEnv({
    workDir: "/tmp/work",
    preserveOperatorHome: true,
    baseEnv: {
      HOME: "/Users/operator",
      PATH: "/usr/bin",
      XAI_API_KEY: "must-not-pass",
    },
  });
  assert.equal(packEnv.HOME, "/Users/operator");
  assert.equal(packEnv.XAI_API_KEY, undefined);
  assert.ok(String(packEnv.npm_config_cache).includes("npm-cache"));
  assert.ok(String(packEnv.npm_config_userconfig).includes("npm-home"));
});

function fixtureProject(base: string): {
  projectRoot: string;
  runbookPath: string;
} {
  const projectRoot = path.join(base, "project");
  const runbookPath = path.join(projectRoot, "docs", BUNDLE_ARTIFACT_NAMES.runbook);
  mkdirSync(path.dirname(runbookPath), { recursive: true });
  writeFileSync(runbookPath, "# runbook\n", "utf8");
  return { projectRoot, runbookPath };
}

function makeFixtureHooks(input: {
  projectRoot: string;
  tarballName?: string;
  commands?: (spec: CommandSpec, state: {
    hubPid: number;
    daemonPid: number;
  }) => CapturedProcess | undefined;
  processAlive?: (pid: number) => boolean;
  failAfterHubStart?: boolean;
  failCleanup?: boolean;
  mcpHandshakeMode?: "protocol" | "syntax-only-reject";
}): {
  hooks: BundleBuilderHooks;
  tracked: {
    commands: CommandSpec[];
    signals: Array<{ pid: number; signal: NodeJS.Signals }>;
    mcpHandshakes: number;
  };
} {
  const tarballName = input.tarballName ?? "forklight-0.2.0.tgz";
  const tracked = {
    commands: [] as CommandSpec[],
    signals: [] as Array<{ pid: number; signal: NodeJS.Signals }>,
    mcpHandshakes: 0,
  };
  const state = {
    hubPid: 4242,
    daemonPid: 4243,
    hubAlive: false,
    daemonAlive: false,
  };

  const hooks: BundleBuilderHooks = {
    allowUnderNpmTest: true,
    randomSuffix: () => "fixture1",
    nowIso: () => "2026-07-30T12:34:56.000Z",
    processControl: {
      alive: (pid) => {
        if (input.processAlive) return input.processAlive(pid);
        if (pid === state.hubPid) return state.hubAlive;
        if (pid === state.daemonPid) return state.daemonAlive;
        return false;
      },
      signal: (pid, signal) => {
        tracked.signals.push({ pid, signal });
        if (input.failCleanup) return;
        if (pid === state.hubPid) state.hubAlive = false;
        if (pid === state.daemonPid) state.daemonAlive = false;
      },
      sleep: async () => undefined,
      cleanupWaitMs: 20,
    },
    fs: {
      existsSync,
      mkdirSync: (target, options) => {
        mkdirSync(target, options);
      },
      rmSync,
      renameSync,
      copyFileSync,
      readFileSync: (target, encoding) => readFileSync(target, encoding),
      writeFileSync: (target, contents, options) => {
        writeFileSync(target, contents, options);
      },
      statSync: (target) => {
        const stats = statSync(target);
        return {
          isDirectory: () => stats.isDirectory(),
          isFile: () => stats.isFile(),
        };
      },
      hashFile: async () => SAMPLE_SHA,
    },
    handshakeMcp: async () => {
      tracked.mcpHandshakes += 1;
      if (input.mcpHandshakeMode === "syntax-only-reject") {
        throw new BundleBuilderError(
          "mcp-entry-failed",
          "installed MCP entry failed initialize/list-tools handshake",
        );
      }
      return { ok: true, toolCount: 12 };
    },
    runCommand: async (spec) => {
      tracked.commands.push(spec);
      const custom = input.commands?.(spec, state);
      if (custom !== undefined) return custom;

      const args = spec.args.map(String);

      if (spec.command === "npm" && args[0] === "pack") {
        // Require pack-destination into staging work, never bare project pack.
        const destIndex = args.indexOf("--pack-destination");
        assert.ok(destIndex >= 0, "pack must use --pack-destination");
        const dest = args[destIndex + 1]!;
        assert.ok(dest.includes("work") || dest.includes("staging"), "pack destination is private");
        assert.ok(spec.env?.npm_config_cache, "pack uses isolated npm cache");
        assert.ok(spec.env?.HOME, "pack uses isolated HOME");
        assert.equal(spec.env?.DEEPSEEK_API_KEY, undefined);
        writeFileSync(path.join(dest, tarballName), "fake-tarball-bytes", "utf8");
        return {
          exitCode: 0,
          stdout: `${JSON.stringify([{
            id: "forklight@0.2.0",
            name: "forklight",
            version: "0.2.0",
            filename: tarballName,
            nested: { noise: { filename: "ignore.tgz" } },
          }])}\n`,
          stderr: "ℹ tests 12\nℹ pass 12\nℹ fail 0\n",
          durationMs: 1,
          timedOut: false,
        };
      }
      if (spec.command === "tar" && args[0] === "-tzf") {
        return okProcess([
          "package/package.json",
          "package/dist/build-identity.json",
          "package/dist/src/cli.js",
          "package/dist/src/mcp/main.js",
        ].join("\n"));
      }
      if (spec.command === "tar" && args[0] === "-xOf") {
        return okProcess(`${JSON.stringify(SAMPLE_IDENTITY, null, 2)}\n`);
      }
      if (spec.command === "npm" && args[0] === "install") {
        assert.ok(args.includes("--global"), "install uses the isolated global prefix layout");
        assert.ok(spec.env?.npm_config_cache, "install uses isolated npm cache");
        assert.equal(spec.env?.OPENAI_API_KEY, undefined);
        const prefixIndex = args.indexOf("--prefix");
        const prefixDir = args[prefixIndex + 1]!;
        const pkgRoot = path.join(prefixDir, "lib", "node_modules", "forklight");
        mkdirSync(path.join(pkgRoot, "dist", "src", "mcp"), { recursive: true });
        mkdirSync(path.join(prefixDir, "bin"), { recursive: true });
        writeFileSync(path.join(prefixDir, "bin", "forklight"), "#!/bin/sh\n", {
          mode: 0o755,
        });
        writeFileSync(path.join(prefixDir, "bin", "forklight-mcp"), "#!/bin/sh\n", {
          mode: 0o755,
        });
        writeFileSync(
          path.join(pkgRoot, "dist", "build-identity.json"),
          `${JSON.stringify(SAMPLE_IDENTITY, null, 2)}\n`,
        );
        writeFileSync(path.join(pkgRoot, "dist", "src", "cli.js"), "export {};\n");
        writeFileSync(path.join(pkgRoot, "dist", "src", "mcp", "main.js"), "export {};\n");
        return okProcess("added 1 package\n");
      }
      if (args.includes("help")) {
        return okProcess("forklight help\n");
      }
      // Syntax-only --check must not be used for MCP verification.
      if (args.includes("--check")) {
        return failProcess("syntax-only check is not a protocol handshake");
      }
      if (args.includes("restart") && args.includes("--detach")) {
        state.hubAlive = true;
        state.daemonAlive = true;
        return okProcess(JSON.stringify({
          ok: true,
          state: "ready",
          pid: state.hubPid,
          port: 5555,
          replacement: "started",
          nextAction: "use-new-hub",
          browserOpened: false,
        }));
      }
      if (args.includes("hub") && args.includes("status")) {
        return okProcess(JSON.stringify({
          state: "current",
          pid: state.hubPid,
          port: 5555,
          nextAction: "none",
        }));
      }
      if (args.includes("daemon") && args.includes("status")) {
        if (input.failAfterHubStart) {
          return okProcess(JSON.stringify({
            pid: state.daemonPid,
            buildIdentity: {
              ...SAMPLE_IDENTITY,
              buildId: "e".repeat(64),
            },
          }));
        }
        return okProcess(JSON.stringify({
          pid: state.daemonPid,
          buildIdentity: SAMPLE_IDENTITY,
        }));
      }
      if (args.includes("health")) {
        return okProcess(JSON.stringify({
          ok: true,
          identityStatus: "matched",
          clientBuildIdentity: SAMPLE_IDENTITY,
          daemonBuildIdentity: SAMPLE_IDENTITY,
        }));
      }
      if (args.includes("daemon") && args.includes("stop")) {
        if (!input.failCleanup) state.daemonAlive = false;
        return okProcess(JSON.stringify({ stopped: true, message: "Daemon stopped" }));
      }

      return failProcess(`unexpected fixture command: ${spec.command} ${args.join(" ")}`);
    },
  };

  return { hooks, tracked };
}

test("complete verified bundle publishes exactly four approved files", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-ok-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const outputDirectory = path.join(realFsRoot, "ForkLight-Clean-Run.demo");
    const { hooks, tracked } = makeFixtureHooks({ projectRoot });
    const result = await buildCleanRunBundle({
      argv: ["--output", outputDirectory],
      projectRoot,
      hooks,
    });

    assert.equal(result.outputDirectory, outputDirectory);
    assert.equal(result.evidence.schemaVersion, 1);
    assert.equal(result.evidence.status, "ready-for-clean-user-run");
    assert.equal(result.evidence.tarball.file, "forklight-0.2.0.tgz");
    assert.equal(result.evidence.tarball.sha256, SAMPLE_SHA);
    assert.equal(result.evidence.verification.testPassed, 12);
    assert.ok(result.evidence.limits.length >= 4);

    const published = readdirSync(outputDirectory).sort();
    assert.deepEqual(published, [
      BUNDLE_ARTIFACT_NAMES.buildIdentity,
      BUNDLE_ARTIFACT_NAMES.evidence,
      "forklight-0.2.0.tgz",
      BUNDLE_ARTIFACT_NAMES.runbook,
    ].sort());

    const evidence = JSON.parse(
      readFileSync(path.join(outputDirectory, BUNDLE_ARTIFACT_NAMES.evidence), "utf8"),
    ) as unknown;
    assert.ok(isBundleEvidence(evidence));
    assert.ok(!JSON.stringify(evidence).includes(projectRoot));
    assert.equal(tracked.mcpHandshakes, 1, "MCP protocol handshake must run once");
    assert.ok(
      !tracked.commands.some((spec) => spec.args.includes("--check")),
      "must not use node --check for MCP",
    );
    assert.ok(
      tracked.commands.some((spec) =>
        spec.command === "npm"
        && spec.args[0] === "pack"
        && spec.args.includes("--pack-destination")
      ),
    );
    assert.equal(existsSync(path.join(projectRoot, "forklight-0.2.0.tgz")), false);
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("a pre-existing same-name source tarball is never deleted or overwritten", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-source-preserve-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const sourceTarball = path.join(projectRoot, "forklight-0.2.0.tgz");
    writeFileSync(sourceTarball, "user-owned-existing-artifact", "utf8");
    const outputDirectory = path.join(realFsRoot, "ForkLight-Clean-Run.preserve");
    const { hooks } = makeFixtureHooks({ projectRoot });

    await buildCleanRunBundle({
      argv: ["--output", outputDirectory],
      projectRoot,
      hooks,
    });

    assert.equal(
      readFileSync(sourceTarball, "utf8"),
      "user-owned-existing-artifact",
    );
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("existing destination fails before pack install or process launch", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-exists-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const outputDirectory = path.join(realFsRoot, "already-there");
    mkdirSync(outputDirectory);
    writeFileSync(path.join(outputDirectory, "keep.txt"), "preserve\n");
    const { hooks, tracked } = makeFixtureHooks({ projectRoot });

    await assert.rejects(
      () => buildCleanRunBundle({
        argv: ["--output", outputDirectory],
        projectRoot,
        hooks,
      }),
      (error: unknown) => error instanceof BundleBuilderError
        && error.category === "destination-exists",
    );
    assert.equal(tracked.commands.length, 0);
    assert.equal(readFileSync(path.join(outputDirectory, "keep.txt"), "utf8"), "preserve\n");
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("verification failure after Hub start stops exact Hub and daemon PIDs", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-hubfail-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const outputDirectory = path.join(realFsRoot, "ForkLight-Clean-Run.fail");
    const { hooks, tracked } = makeFixtureHooks({
      projectRoot,
      failAfterHubStart: true,
    });

    await assert.rejects(
      () => buildCleanRunBundle({
        argv: ["--output", outputDirectory],
        projectRoot,
        hooks,
      }),
      (error: unknown) => error instanceof BundleBuilderError
        && error.category === "daemon-identity-mismatch",
    );

    const signalled = new Set(tracked.signals.map((entry) => entry.pid));
    assert.ok(signalled.has(4242), "exact hub pid must be signalled");
    assert.ok(
      tracked.commands.some((spec) => spec.args.includes("daemon") && spec.args.includes("stop")),
      "isolated-home daemon stop must run",
    );
    // Daemon is stopped via isolated home; exact pid is signalled only if still alive.
    assert.ok(
      signalled.has(4243) || tracked.commands.some((spec) =>
        spec.args.includes("daemon") && spec.args.includes("stop")
      ),
      "exact daemon pid must be owned for cleanup",
    );
    assert.equal(existsSync(outputDirectory), false);
    assert.equal(
      existsSync(path.join(realFsRoot, ".forklight-clean-run-staging.fixture1")),
      false,
    );
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("cleanup failure is not hidden behind the earlier verification error", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-cleanup-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const outputDirectory = path.join(realFsRoot, "ForkLight-Clean-Run.cleanup");
    const { hooks } = makeFixtureHooks({
      projectRoot,
      failAfterHubStart: true,
      failCleanup: true,
    });

    await assert.rejects(
      () => buildCleanRunBundle({
        argv: ["--output", outputDirectory],
        projectRoot,
        hooks,
      }),
      (error: unknown) => error instanceof BundleBuilderError
        && error.category === "cleanup-failed",
    );
    assert.equal(existsSync(outputDirectory), false);
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("sensitive package entry stops publication without leaking the filename", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-sensitive-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const outputDirectory = path.join(realFsRoot, "ForkLight-Clean-Run.sensitive");
    const { hooks } = makeFixtureHooks({
      projectRoot,
      commands: (spec) => {
        if (spec.command === "tar" && spec.args[0] === "-tzf") {
          return okProcess("package/dist/cli.js\npackage/.env\n");
        }
        return undefined;
      },
    });

    await assert.rejects(
      () => buildCleanRunBundle({
        argv: ["--output", outputDirectory],
        projectRoot,
        hooks,
      }),
      (error: unknown) => {
        if (!(error instanceof BundleBuilderError)) return false;
        if (error.category !== "sensitive-package-entry") return false;
        assert.ok(!error.message.includes(".env"));
        return true;
      },
    );
    assert.equal(existsSync(outputDirectory), false);
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("pack install failure removes staging and leaves no public residue", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-install-fail-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const outputDirectory = path.join(realFsRoot, "ForkLight-Clean-Run.install");
    const { hooks, tracked } = makeFixtureHooks({
      projectRoot,
      commands: (spec) => {
        if (spec.command === "npm" && spec.args[0] === "install") {
          return failProcess("install failed");
        }
        return undefined;
      },
    });

    await assert.rejects(
      () => buildCleanRunBundle({
        argv: ["--output", outputDirectory],
        projectRoot,
        hooks,
      }),
      (error: unknown) => error instanceof BundleBuilderError
        && error.category === "install-failed",
    );
    assert.equal(existsSync(outputDirectory), false);
    assert.equal(
      existsSync(path.join(realFsRoot, ".forklight-clean-run-staging.fixture1")),
      false,
    );
    assert.equal(existsSync(path.join(projectRoot, "forklight-0.2.0.tgz")), false);
    assert.ok(tracked.commands.some((spec) => spec.args[0] === "pack"));
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("MCP handshake seam rejects syntax-only substitution", async () => {
  const realFsRoot = mkdtempSync(path.join(tmpdir(), "forklight-bundle-mcp-"));
  try {
    const { projectRoot } = fixtureProject(realFsRoot);
    const outputDirectory = path.join(realFsRoot, "ForkLight-Clean-Run.mcp");
    const { hooks, tracked } = makeFixtureHooks({
      projectRoot,
      mcpHandshakeMode: "syntax-only-reject",
    });

    await assert.rejects(
      () => buildCleanRunBundle({
        argv: ["--output", outputDirectory],
        projectRoot,
        hooks,
      }),
      (error: unknown) => error instanceof BundleBuilderError
        && error.category === "mcp-entry-failed",
    );
    assert.equal(tracked.mcpHandshakes, 1);
    assert.equal(existsSync(outputDirectory), false);
  } finally {
    rmSync(realFsRoot, { recursive: true, force: true });
  }
});

test("builder under npm test refuses real pack without allowUnderNpmTest seam", async () => {
  const previous = process.env.npm_lifecycle_event;
  process.env.npm_lifecycle_event = "test";
  try {
    await assert.rejects(
      () => buildCleanRunBundle({
        argv: ["--output", path.join(tmpdir(), "should-not-create")],
        projectRoot: root,
      }),
      (error: unknown) => error instanceof BundleBuilderError
        && error.category === "recursive-pack-refused",
    );
  } finally {
    if (previous === undefined) delete process.env.npm_lifecycle_event;
    else process.env.npm_lifecycle_event = previous;
  }
});

test("package script declares bundle:clean operator command", async () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.ok(pkg.scripts?.["bundle:clean"]?.includes("build-clean-run-bundle"));
});
