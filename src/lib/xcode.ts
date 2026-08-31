import { existsSync } from "node:fs";
import { run, runOrThrow } from "./exec.js";

/**
 * Readers for the generated Xcode artifacts.
 *
 * The parsing functions are pure and take text, because the defect that
 * motivated this package lived in exactly this layer: TARGETED_DEVICE_FAMILY
 * was never set, Xcode's universal default won by silence, and no test could
 * see it. A pure function over a fixture pbxproj can.
 */

/**
 * Every distinct value a build setting takes across all configurations.
 *
 * Returns a SET rather than a single value on purpose. A project has one entry
 * per target per configuration, and they can disagree — which is not a corner
 * case: setting TARGETED_DEVICE_FAMILY on the app target while the UI-test
 * bundle kept the universal default left "1,2" in the project and is what a
 * single-value reader would have missed.
 */
export function buildSettingValues(pbxproj: string, key: string): Set<string> {
  const values = new Set<string>();
  const re = new RegExp(`^\\s*${key}\\s*=\\s*([^;]+);`, "gm");
  for (const m of pbxproj.matchAll(re)) {
    const raw = (m[1] ?? "").trim();
    values.add(raw.replace(/^"(.*)"$/, "$1"));
  }
  return values;
}

/** True when every occurrence of `key` equals `expected`, and there is at least one. */
export function buildSettingIs(pbxproj: string, key: string, expected: string): boolean {
  const values = buildSettingValues(pbxproj, key);
  return values.size === 1 && values.has(expected);
}

/** Read one key out of a plist via plutil. Returns null when absent. */
export function plistValue(plistPath: string, key: string): string | null {
  if (!existsSync(plistPath)) return null;
  const res = run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
  return res.ok ? res.stdout.trim() : null;
}

export function plistHasKey(plistPath: string, key: string): boolean {
  if (!existsSync(plistPath)) return false;
  return run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath]).ok;
}

/** Whole plist as printed text — for keys nested inside arrays plutil cannot address. */
export function plistText(plistPath: string): string {
  if (!existsSync(plistPath)) return "";
  const res = run("/usr/bin/plutil", ["-p", plistPath]);
  return res.ok ? res.stdout : "";
}

/** Regenerate the project from project.yml. */
export function xcodegen(projectDir: string): { ok: boolean; detail: string } {
  const res = run("xcodegen", ["generate"], { cwd: projectDir });
  return { ok: res.ok, detail: (res.stderr || res.stdout).trim().slice(0, 300) };
}

/** True when the PNG carries an alpha channel — App Store Connect rejects those icons. */
export function pngHasAlpha(file: string): boolean | null {
  if (!existsSync(file)) return null;
  const out = runOrThrow("/usr/bin/sips", ["-g", "hasAlpha", file]);
  const m = out.match(/hasAlpha:\s*(\w+)/);
  return m ? m[1] === "yes" : null;
}

export interface PngSize { width: number; height: number }

export function pngSize(file: string): PngSize | null {
  if (!existsSync(file)) return null;
  const out = runOrThrow("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const w = out.match(/pixelWidth:\s*(\d+)/);
  const h = out.match(/pixelHeight:\s*(\d+)/);
  return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null;
}
