import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 1_000_000;

export interface CapturedProcess {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function appendLimited(current: string, chunk: Buffer | string): string {
  if (current.length >= OUTPUT_LIMIT) return current;
  const next = current + chunk.toString();
  if (next.length <= OUTPUT_LIMIT) return next;
  return `${next.slice(0, OUTPUT_LIMIT)}\n[output truncated by ForkLight]\n`;
}

export function runCaptured(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<CapturedProcess> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({
        exitCode: code ?? (signal ? 128 : 1),
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}
