/**
 * Hub is the only control-center UI: assets + security invariants + packaging.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubPublic = path.join(root, "src", "hub", "public");

test("Hub is the only control UI package path in npm build", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const build = pkg.scripts.build ?? "";
  assert.ok(/copy-hub-assets/.test(build), "build must package Hub assets");
  assert.ok(!/copy-console-assets/.test(build), "build must not package Console assets");
  assert.ok(!/copy-setup-assets/.test(build), "build must not package Setup UI assets");
});

test("Hub public assets exist with configure + operate chrome", async () => {
  const html = await readFile(path.join(hubPublic, "index.html"), "utf8");
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes('data-tab="model"') && html.includes('data-tab="tasks"'));
  assert.ok(html.includes('id="fl-detail"'));
  assert.ok(js.includes("X-ForkLight-Hub-Token"));
  assert.ok(js.includes("function kanbanCard"));
  assert.ok(css.length > 200);
});

test("Hub app.js security and decision-drawer invariants", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(!/\.innerHTML\s*=/.test(src));
  assert.ok(!/onclick\s*=/i.test(src));
  assert.ok(!/\.style\./.test(src));
  assert.ok(!/—/.test(src));
  for (const label of [
    "Worker claim (unverified)",
    "Independent verification",
    "Main agent review",
    "User authorization",
    "Integration and activation",
    "Next action",
  ]) {
    assert.ok(src.includes(label), `decision drawer must include ${label}`);
  }
  assert.ok(!/sessionStorage|document\.cookie|[^.]\bcookie\s*=/.test(src));
  const storageStripped = src
    .replace(/localStorage\.getItem\(\s*["']fl-theme["']\s*\)/g, "/*theme*/")
    .replace(/localStorage\.setItem\(\s*["']fl-theme["']\s*,/g, "/*theme*/");
  assert.ok(!/localStorage/.test(storageStripped));
  assert.ok(src.includes("readToken"));
  assert.ok(src.includes("token.length!==43"));
  assert.ok(!src.includes("?token="));
});

test("Hub economics renderer keeps truthful labels", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(/offloaded/i.test(src));
  assert.ok(!/saved tokens/i.test(src));
  assert.ok(/counterfactual/i.test(src));
  assert.ok(/not yet measurable/i.test(src));
  assert.ok(!/grand.?total/i.test(src));
  assert.ok(/function evAmount\(/.test(src));
  assert.match(css, /\.economics-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr\s+1fr/i);
  assert.match(
    css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{\s*\.economics-grid\s*\{\s*grid-template-columns\s*:\s*1fr\s*\}/i,
  );
});

test("shipped tree has no Console product server or Setup UI server", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(path.join(root, "src", "console")), false);
  assert.equal(existsSync(path.join(root, "src", "setup", "server.ts")), false);
  assert.equal(existsSync(path.join(root, "src", "setup", "public")), false);
  assert.equal(existsSync(path.join(root, "scripts", "copy-console-assets.mjs")), false);
  assert.equal(existsSync(path.join(root, "scripts", "copy-setup-assets.mjs")), false);
  // SetupService remains for doctor/hub
  assert.equal(existsSync(path.join(root, "src", "setup", "service.ts")), true);
});
