import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 1_000_000;

export interface CapturedProcess {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
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
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CapturedProcess> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (code: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? (signal ? 128 : 1)),
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, options.timeoutMs);
      timer.unref();
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code, signal) => finish(code, signal));
  });
}
