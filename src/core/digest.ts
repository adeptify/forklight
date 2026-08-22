import { createHash } from "node:crypto";

/** Canonical hex-encoded SHA-256 digest of a string or buffer. */
export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
