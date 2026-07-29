import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keychainWriteArguments } from "../src/core/secrets.js";

test("Keychain write argv authorizes only the system security tool and never contains the credential", () => {
  const marker = "provider-secret-must-not-enter-argv";
  const args = keychainWriteArguments("forklight.deepseek.api-key", "local-user");
  assert.deepEqual(args, [
    "add-generic-password",
    "-U",
    "-a",
    "local-user",
    "-s",
    "forklight.deepseek.api-key",
    "-T",
    "/usr/bin/security",
    "-w",
  ]);
  assert.equal(args.includes(marker), false);
  assert.equal(args.at(-1), "-w", "a trailing -w makes security read the value from stdin");
  assert.equal(args.includes("-A"), false, "never grant every application access");
});

test("interactive setup scripts use stdin and the same bounded Keychain ACL", async () => {
  for (const file of [
    "scripts/setup-provider-key.sh",
    "scripts/setup-volcengine-coding-plan-key.sh",
  ]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /-T \/usr\/bin\/security/);
    assert.match(source, /-w >\/dev\/null/);
    assert.match(source, /"\$\{USER:-\}" "\$\{LOGNAME:-\}"/);
    assert.match(source, /\^\[A-Za-z0-9\._-\]\{1,128\}\$/);
    assert.doesNotMatch(source, /-w "\$\{[^}]+\}"/);
    assert.doesNotMatch(source, /-A(?:\s|\\)/);
  }
});
