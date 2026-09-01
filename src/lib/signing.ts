import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./exec.js";

export interface Identity { hash: string; name: string; kind: "development" | "distribution" | "other" }

export function codesigningIdentities(): Identity[] {
  const out = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]).stdout;
  const identities: Identity[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/);
    if (!m) continue;
    const name = m[2]!;
    identities.push({
      hash: m[1]!,
      name,
      kind: name.startsWith("Apple Distribution") ? "distribution"
          : name.startsWith("Apple Development") ? "development"
          : "other",
    });
  }
  return identities;
}

const PROFILE_DIR = join(homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles");

/**
 * Team IDs from installed provisioning profiles.
 *
 * Deliberately NOT from the signing identity. The parenthetical in
 * "Apple Development: Name (XXXXXXXXXX)" is the individual's id — it looks
 * exactly like a Team ID, is a different value, and suggesting it sends you
 * round a loop of signing errors that all blame the wrong thing.
 */
export function teamIdsFromProfiles(): string[] {
  if (!existsSync(PROFILE_DIR)) return [];
  const teams = new Set<string>();
  for (const file of readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".mobileprovision"))) {
    const decoded = run("/usr/bin/security", ["cms", "-D", "-i", join(PROFILE_DIR, file)]).stdout;
    const m = decoded.match(/<key>ApplicationIdentifierPrefix<\/key>\s*<array>\s*<string>([^<]+)<\/string>/);
    if (m) teams.add(m[1]!);
  }
  return [...teams];
}

/** Outcome of the keychain probe. `prompts: null` means it could not be measured. */
export interface KeychainProbe {
  prompts: boolean | null;
  /** What was actually observed — printed, so neither verdict is a bare claim. */
  detail: string;
}

/**
 * Whether `codesign` can use a key without raising a keychain prompt.
 *
 * An unanswered prompt does not surface as "a dialog is waiting". It surfaces
 * as `errSecInternalComponent` several hundred lines into a build log, after
 * the archive has already failed. Detecting it up front is the difference
 * between a one-line fix and an afternoon.
 *
 * Signing a throwaway copy is the only reliable probe — the ACL is not
 * otherwise readable without itself prompting.
 *
 * The exit status is read rather than just "did it work". Only a watchdog kill
 * (137 = 128 + SIGKILL) means codesign was still waiting, which is what a
 * SecurityAgent dialog looks like from here. Any OTHER non-zero exit — an
 * expired or untrusted certificate, an identity not valid for signing,
 * codesign missing from PATH — is a failure to MEASURE, not evidence of a
 * prompt. Treating those as "prompts" told people to run
 * set-key-partition-list on machines whose keychain was fine.
 */
export function keychainPromptsForSigning(identityHash: string, timeoutMs = 6000): KeychainProbe {
  const tmp = join(process.env.TMPDIR ?? "/tmp", `appstore-kit-signprobe-${process.pid}`);
  const copy = run("/bin/cp", ["/bin/echo", tmp]);
  if (!copy.ok) return { prompts: null, detail: `could not stage a probe binary at ${tmp}` };
  const started = Date.now();
  const res = run("/bin/sh", ["-c",
    `codesign --force --sign ${identityHash} ${tmp} >/dev/null 2>&1 & pid=$!; ` +
    `( sleep ${timeoutMs / 1000}; kill -9 $pid 2>/dev/null ) & watchdog=$!; ` +
    `wait $pid 2>/dev/null; status=$?; kill -9 $watchdog 2>/dev/null; exit $status`,
  ]);
  run("/bin/rm", ["-f", tmp]);
  return interpretProbe(res.status, Date.now() - started, timeoutMs);
}

/**
 * PURE. Turn a codesign exit status and duration into a verdict.
 *
 * Separated from the shell-out so the distinction this function exists to make
 * is testable: only 137 (128 + SIGKILL, the watchdog firing) means codesign was
 * still blocked. Every other non-zero exit is a failure to measure. The version
 * that returned `true` for any non-zero exit told people to run
 * set-key-partition-list because their certificate had expired.
 */
export function interpretProbe(status: number | null, elapsedMs: number, timeoutMs: number): KeychainProbe {
  if (status === 137) {
    return { prompts: true, detail: `codesign did not return within ${timeoutMs / 1000}s (killed by watchdog)` };
  }
  if (status !== 0) {
    return {
      prompts: null,
      detail: `codesign exited ${status} without prompting — probe inconclusive (check the certificate is valid for signing)`,
    };
  }
  // A key with codesign in its partition list signs in milliseconds. Signing
  // that succeeded but took most of the timeout means a dialog appeared and
  // someone answered it.
  if (elapsedMs > timeoutMs - 1000) {
    return { prompts: true, detail: `codesign took ${elapsedMs}ms — a prompt appeared and was answered` };
  }
  return { prompts: false, detail: `signed a probe binary in ${elapsedMs}ms without prompting` };
}

export const PARTITION_LIST_FIX =
  "security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <login-password> ~/Library/Keychains/login.keychain-db";
