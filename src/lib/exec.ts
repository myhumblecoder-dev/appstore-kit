import { execFileSync, spawnSync } from "node:child_process";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Run a command, never throwing. Callers decide what a non-zero exit means. */
export function run(cmd: string, args: string[], opts: { cwd?: string } = {}): RunResult {
  const res = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status,
  };
}

/** Run a command, throwing on failure with the stderr attached. */
export function runOrThrow(cmd: string, args: string[], opts: { cwd?: string } = {}): string {
  try {
    return execFileSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`${cmd} ${args.join(" ")} failed: ${(e.stderr || e.message).slice(0, 500)}`);
  }
}

export function which(cmd: string): string | null {
  const res = run("/usr/bin/which", [cmd]);
  return res.ok ? res.stdout.trim() : null;
}
