import { forklightHome } from "../core/config.js";
import {
  createBackup,
  formatBackupHuman,
  inspectBackup,
  previewBackup,
  previewRestore,
  restoreBackup,
  type BackupServiceOptions,
} from "../core/backup.js";
import type { BackupResult } from "../core/types.js";

export const BACKUP_USAGE = `  forklight backup preview --destination <dir> [--json]
  forklight backup create --destination <dir> --confirm [--json]
  forklight backup inspect <backup-dir> [--json]
  forklight backup restore <backup-dir> [--confirm] [--json]
      # preview/inspect never mutate or start Daemon/Hub
      # create/restore require --confirm; restore refuses a live or unverified owner
`;

export interface BackupCliDependencies {
  home?: string;
  options?: BackupServiceOptions;
}

export interface BackupCliResult {
  stdout: string;
  result: BackupResult;
}

function parseBackupArgs(args: string[]): {
  subcommand: string | undefined;
  positional: string | undefined;
  destination: string | undefined;
  confirm: boolean;
  json: boolean;
} {
  const tokens = args.filter((item) => item !== undefined);
  const json = tokens.includes("--json");
  const confirm = tokens.includes("--confirm");
  const rest: string[] = [];
  let destination: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--json" || token === "--confirm") continue;
    if (token === "--destination") {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`backup requires a value for --destination\n\n${BACKUP_USAGE}`);
      }
      if (destination !== undefined) {
        throw new Error(`backup duplicate flag: --destination\n\n${BACKUP_USAGE}`);
      }
      destination = value;
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`Unknown backup flag: ${token}\n\n${BACKUP_USAGE}`);
    }
    rest.push(token);
  }
  return {
    subcommand: rest[0],
    positional: rest[1],
    destination,
    confirm,
    json,
  };
}

function render(result: BackupResult, json: boolean): string {
  return json ? `${JSON.stringify(result, null, 2)}\n` : formatBackupHuman(result);
}

export async function runBackupCommand(
  args: string[],
  deps: BackupCliDependencies = {},
): Promise<BackupCliResult> {
  const parsed = parseBackupArgs(args);
  const home = deps.home ?? forklightHome();
  const options = deps.options ?? {};
  if (parsed.subcommand === undefined) {
    throw new Error(`backup requires a subcommand\n\n${BACKUP_USAGE}`);
  }
  if (parsed.positional !== undefined
    && parsed.subcommand !== "inspect"
    && parsed.subcommand !== "restore") {
    throw new Error(`backup ${parsed.subcommand} does not take a positional path\n\n${BACKUP_USAGE}`);
  }

  if (parsed.subcommand === "preview") {
    if (parsed.destination === undefined) {
      throw new Error(`backup preview requires --destination <dir>\n\n${BACKUP_USAGE}`);
    }
    if (parsed.confirm) {
      throw new Error("backup preview does not accept --confirm");
    }
    const result = await previewBackup(home, parsed.destination, options);
    return { stdout: render(result, parsed.json), result };
  }

  if (parsed.subcommand === "create") {
    if (parsed.destination === undefined) {
      throw new Error(`backup create requires --destination <dir>\n\n${BACKUP_USAGE}`);
    }
    if (!parsed.confirm) {
      throw new Error(`backup create requires explicit --confirm\n\n${BACKUP_USAGE}`);
    }
    const result = await createBackup(home, parsed.destination, options);
    return { stdout: render(result, parsed.json), result };
  }

  if (parsed.subcommand === "inspect") {
    if (parsed.positional === undefined) {
      throw new Error(`backup inspect requires <backup-dir>\n\n${BACKUP_USAGE}`);
    }
    if (parsed.destination !== undefined) {
      throw new Error("backup inspect does not accept --destination");
    }
    if (parsed.confirm) {
      throw new Error("backup inspect does not accept --confirm");
    }
    const result = await inspectBackup(parsed.positional, options);
    return { stdout: render(result, parsed.json), result };
  }

  if (parsed.subcommand === "restore") {
    if (parsed.positional === undefined) {
      throw new Error(`backup restore requires <backup-dir>\n\n${BACKUP_USAGE}`);
    }
    if (parsed.destination !== undefined) {
      throw new Error("backup restore does not accept --destination");
    }
    const result = parsed.confirm
      ? await restoreBackup(home, parsed.positional, options)
      : await previewRestore(home, parsed.positional, options);
    return { stdout: render(result, parsed.json), result };
  }

  throw new Error(
    `Unknown backup subcommand: ${parsed.subcommand}. Use: preview, create, inspect, or restore.`,
  );
}
