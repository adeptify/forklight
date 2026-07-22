import { execFileSync } from "node:child_process";
import type { TaskSpec } from "./types.js";
import { keychainAccount } from "./config.js";

export function readProviderKey(spec: TaskSpec): string {
  try {
    const value = execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        keychainAccount(spec),
        "-s",
        spec.provider.keychainService,
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (!value) throw new Error("Keychain returned an empty value");
    return value;
  } catch {
    throw new Error(
      `Unable to read provider credential from Keychain service ${spec.provider.keychainService}`,
    );
  }
}
