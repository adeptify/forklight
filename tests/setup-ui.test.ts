import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupDir = path.join(root, "src", "setup", "public");

async function loadAssets() {
  const [html, css, js] = await Promise.all([
    readFile(path.join(setupDir, "index.html"), "utf8"),
    readFile(path.join(setupDir, "app.css"), "utf8"),
    readFile(path.join(setupDir, "app.js"), "utf8"),
  ]);
  return { html, css, js };
}

function extractBody(source: string, fnName: string): string {
  const re = new RegExp("function\\s+" + fnName + "\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\s*\\}", "g");
  const match = re.exec(source);
  return match ? match[0] : "";
}

test("setup assets exist and reference each other", async () => {
  const { html, css, js } = await loadAssets();
  assert.ok(html.startsWith("<!DOCTYPE html>"), "index.html must start with doctype");
  assert.ok(/ForkLight setup/i.test(html), "title must mention ForkLight setup");
  assert.ok(html.includes("app.css"), "html must reference app.css");
  assert.ok(html.includes("app.js"), "html must reference app.js");
  assert.ok(css.length > 200, "app.css must contain real styles");
  assert.ok(js.length > 500, "app.js must contain real logic");
  assert.ok(js.includes("ForkLight"), "app.js must identify the project");
});

test("setup assets avoid unsafe DOM insertion and em dash", async () => {
  const { html, css, js } = await loadAssets();
  assert.ok(!/\.innerHTML\s*=/.test(js), "app.js must not assign innerHTML");
  assert.ok(!/\binsertAdjacentHTML\s*\(/.test(js), "app.js must not use insertAdjacentHTML");
  assert.ok(!/\bdocument\.write\s*\(/.test(js), "app.js must not use document.write");
  assert.ok(!/outerHTML\s*=/.test(js), "app.js must not assign outerHTML");
  assert.ok(!/\bonclick\s*=/i.test(html + js), "must not contain onclick handlers");
  assert.ok(!/\bon[a-z]+\s*=/i.test(html), "html must not contain inline event handlers");
  assert.ok(!/\.style\.\w+\s*=/.test(js), "app.js must not write to .style.* properties");
  assert.ok(!/[—–]/.test(html + css + js), "assets must not contain em/en dash characters");
  assert.ok(!/<script[^>]*src=["']http/i.test(html), "html must not load remote scripts");
  assert.ok(!/@import/i.test(css), "css must not import external resources");
});

test("setup assets never persist or URL-encode credentials", async () => {
  const { js } = await loadAssets();
  assert.ok(!/localStorage/.test(js), "app.js must not use localStorage");
  assert.ok(!/sessionStorage/.test(js), "app.js must not use sessionStorage");
  assert.ok(!/document\.cookie/.test(js), "app.js must not access cookies");
  assert.ok(!/indexedDB/.test(js), "app.js must not use indexedDB");
  assert.ok(!/navigator\.clipboard/.test(js), "app.js must not write to clipboard");
  const headerHits = js.match(/X-ForkLight-Setup-Token/g) || [];
  assert.ok(headerHits.length >= 1, "must reference the token header");
  assert.ok(!/apiKey[^\n]*location/.test(js), "api key must not touch location");
  assert.ok(!/apiKey[^\n]*search|apiKey[^\n]*hash/i.test(js),
    "api key must never be placed in URL search or fragment");
  assert.ok(!/history\.pushState/.test(js), "app.js must not use pushState with credentials");
});

test("setup requires explicit user action for the billable probe", async () => {
  const { js, html } = await loadAssets();
  assert.ok(/\/api\/probe/.test(js), "app.js must call /api/probe");
  assert.ok(/confirm\(/.test(js), "app.js must require explicit confirmation before probing");
  assert.ok(/#fl-btn-probe/.test(js), "probe must be wired to a button in the DOM");
  assert.ok(/addEventListener\(\s*["']click["']/.test(js), "events must use addEventListener");
  const clearCount = (js.match(/keyInput\.value\s*=\s*["']["']/g) || []).length;
  assert.ok(clearCount >= 1, "key input must be cleared before the probe settles");
  const initBody = extractBody(js, "init");
  assert.ok(initBody.length > 0, "init function must be parseable");
  assert.ok(!/\/api\/probe/.test(initBody), "init must not call /api/probe");
  assert.ok(!/probe\s*\(/.test(initBody), "init must not call probe()");
  assert.ok(!/addEventListener\(\s*["']change["'][\s\S]{0,200}api\/probe/.test(js),
    "probe must not be triggered by change events");
  assert.ok(/type=["']password["']/.test(html), "key input must be type=password");
});

test("setup HTML provides accessible structure and progressive disclosure", async () => {
  const { html, js } = await loadAssets();
  assert.ok(/<h1\b/.test(html), "must contain an h1 heading");
  assert.ok(/<h2\b/.test(html), "must contain stage h2 headings");
  assert.ok(/aria-current=/.test(html), "must mark current step with aria-current");
  assert.ok(/aria-live=/.test(html), "must include aria-live regions for status changes");
  assert.ok(/role=["']alert["']/.test(html), "errors must be in an alert region");
  assert.ok(/<form\b/.test(html), "must contain a real form for provider input");
  assert.ok(/<fieldset\b/.test(html), "groups must use fieldsets");
  assert.ok(/<legend\b/.test(html), "groups must have legends");
  assert.ok(/<details\b/.test(html), "advanced controls must use <details> for progressive disclosure");
  assert.ok(/type=["']password["']/.test(html), "key must be a password input");
  assert.ok(/type=["']url["']/.test(html), "endpoint override should use input type=url");
  assert.ok(/input\.type\s*=\s*["']radio["']/.test(js), "dynamic selectors must use radio inputs");
  assert.ok(/hd\(["']label["']/.test(js), "dynamic radio inputs must be wrapped by labels");
  assert.ok(/<button[^>]*type=["']button["']/.test(html), "non-submit buttons must declare type=button");
});

test("setup CSS supports mobile width, focus, and reduced motion", async () => {
  const { css } = await loadAssets();
  assert.ok(/@media\s*\([^)]*max-width:\s*420/.test(css), "must declare a narrow mobile breakpoint <= 420px");
  assert.ok(/@media\s*\([^)]*max-width:\s*520/.test(css), "must collapse grids on narrow viewports");
  assert.ok(/:focus-visible/.test(css), "must define focus-visible styles");
  assert.ok(/prefers-reduced-motion/.test(css), "must respect reduced-motion preference");
  assert.ok(/overflow-x:\s*hidden/.test(css), "must prevent page-level horizontal overflow");
  assert.ok(/box-sizing:\s*border-box/.test(css), "must use border-box for layout stability");
  assert.ok(/min-width:\s*0/.test(css), "flex/grid children must allow shrinking below content width");
});

test("setup app.js consumes the fixed API contract and reads token from fragment", async () => {
  const { js } = await loadAssets();
  for (const endpoint of ["/api/bootstrap", "/api/provider", "/api/probe", "/api/plugin", "/api/finish"]) {
    assert.ok(js.includes(endpoint), `app.js must consume ${endpoint}`);
  }
  assert.ok(/location\.hash/.test(js), "app.js must read the setup token from URL fragment");
  assert.ok(/history\.replaceState/.test(js), "app.js must strip the visible fragment after extraction");
});

test("package.json wires the setup packager into npm run build", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as Record<string, unknown>;
  const build = (pkg.scripts as Record<string, string> | undefined)?.build;
  assert.ok(build, "package.json must define a build script");
  assert.ok(/copy-console-assets/.test(build), "build must still package console assets");
  assert.ok(/copy-setup-assets/.test(build), "build must package setup assets");
  const copier = await readFile(path.join(root, "scripts", "copy-setup-assets.mjs"), "utf8");
  assert.ok(/src[\\/]+setup[\\/]+public/.test(copier), "copier must target src/setup/public");
  assert.ok(/dist/.test(copier), "copier must write into dist");
  for (const f of ["index.html", "app.css", "app.js"]) {
    assert.ok(copier.includes(f), `copier must copy ${f}`);
  }
});

test("setup keychain handling: token is in-memory, never echoed or URL-bound", async () => {
  const { js, html } = await loadAssets();
  const tokenRef = js.match(/state\.token\s*=\s*token/);
  assert.ok(tokenRef, "token must be assigned into in-memory state");
  assert.ok(/X-ForkLight-Setup-Token/.test(js), "token must be sent as header");
  assert.ok(!/setup[_-]?token/i.test(html), "html must not display the token");
  assert.ok(!/alert\s*\(/.test(js), "app.js must not pop alerts that may echo the key");
});
