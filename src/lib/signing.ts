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
 */
export function keychainPromptsForSigning(identityHash: string, timeoutMs = 6000): boolean | null {
  const tmp = join(process.env.TMPDIR ?? "/tmp", `appstore-kit-signprobe-${process.pid}`);
  const copy = run("/bin/cp", ["/bin/echo", tmp]);
  if (!copy.ok) return null;
  const started = Date.now();
  const res = run("/bin/sh", ["-c",
    `codesign --force --sign ${identityHash} ${tmp} >/dev/null 2>&1 & pid=$!; ` +
    `( sleep ${timeoutMs / 1000}; kill -9 $pid 2>/dev/null ) & watchdog=$!; ` +
    `wait $pid 2>/dev/null; status=$?; kill -9 $watchdog 2>/dev/null; exit $status`,
  ]);
  run("/bin/rm", ["-f", tmp]);
  // A key with codesign in its partition list signs in milliseconds. Anything
  // near the timeout means SecurityAgent put a dialog on screen.
  if (!res.ok) return true;
  return Date.now() - started > timeoutMs - 1000;
}

export const PARTITION_LIST_FIX =
  "security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <login-password> ~/Library/Keychains/login.keychain-db";
