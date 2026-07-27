import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

export interface SourceTreeIdentity {
  digest: string;
  latestModifiedAt: string;
  fileCount: number;
}

function visitFiles(
  directory: string,
  accept: (name: string) => boolean,
  output: string[],
): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visitFiles(absolute, accept, output);
    else if (entry.isFile() && accept(entry.name)) output.push(absolute);
  }
}

/** Files that materially produce ForkLight's executable and Hub assets. */
export function sourceInputFiles(root: string): string[] {
  const files: string[] = [];
  for (const relative of ["package.json", "tsconfig.json"]) {
    const absolute = path.join(root, relative);
    if (existsSync(absolute)) files.push(absolute);
  }
  visitFiles(path.join(root, "src"), (name) => name.endsWith(".ts"), files);
  visitFiles(path.join(root, "scripts"), (name) => name.endsWith(".mjs"), files);
  visitFiles(path.join(root, "src", "hub", "public"), () => true, files);
  return [...new Set(files)].sort();
}

/** Read-only deterministic identity shared by development and production builds. */
export function inspectSourceTree(root: string): SourceTreeIdentity {
  const hash = createHash("sha256");
  const files = sourceInputFiles(root);
  let latestMtimeMs = 0;
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    hash.update(relative);
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
    latestMtimeMs = Math.max(latestMtimeMs, statSync(file).mtimeMs);
  }
  return {
    digest: hash.digest("hex"),
    latestModifiedAt: new Date(latestMtimeMs).toISOString(),
    fileCount: files.length,
  };
}
