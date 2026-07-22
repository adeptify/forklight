import { execFileSync } from "node:child_process";
import type { TaskSpec } from "./types.js";
import { keychainAccount } from "./config.js";
import type { SetupKeychainStore } from "../setup/types.js";

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

export function createKeychainStore(): SetupKeychainStore {
  return {
    has(service, account) {
      try {
        execFileSync(
          "security",
          ["find-generic-password", "-a", account, "-s", service],
          { stdio: "ignore" },
        );
        return true;
      } catch {
        return false;
      }
    },
    read(service, account) {
      try {
        const value = execFileSync(
          "security",
          ["find-generic-password", "-a", account, "-s", service, "-w"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        return value || undefined;
      } catch {
        return undefined;
      }
    },
    write(service, account, value) {
      execFileSync(
        "security",
        ["add-generic-password", "-U", "-a", account, "-s", service, "-w", value],
        { stdio: "ignore" },
      );
    },
    delete(service, account) {
      if (!this.has(service, account)) return;
      execFileSync(
        "security",
        ["delete-generic-password", "-a", account, "-s", service],
        { stdio: "ignore" },
      );
    },
  };
}
