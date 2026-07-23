import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = 2;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const builtAt = new Date().toISOString();
let sourceRevision = "unknown";
try {
  sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  // Source archives may not include Git metadata.
}
const input = [
  String(PROTOCOL_VERSION),
  String(packageJson.version),
  sourceRevision,
  builtAt,
].join("\0");
const identity = {
  protocolVersion: PROTOCOL_VERSION,
  packageVersion: String(packageJson.version),
  buildId: createHash("sha256").update(input).digest("hex"),
  builtAt,
  sourceRevision,
};
const destination = path.join(root, "dist", "build-identity.json");
mkdirSync(path.dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o644 });
process.stdout.write("Build identity generated.\n");
