import { existsSync } from "node:fs";
import { run } from "./exec.js";

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
  // [^;\n]+ rather than [^;]+ : a character class matches newlines, so a
  // multi-line list value (OTHER_LDFLAGS = (\n "-ObjC",\n);) would swallow
  // every line up to the first semicolon and report it as one value.
  // The key is escaped because it is interpolated into a pattern.
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}\\s*=\\s*([^;\n]+);`, "gm");
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

/**
 * Every scheme registered under CFBundleURLTypes. Null when it cannot be read.
 *
 * Scoped rather than a substring search of `plutil -p`: the dump contains every
 * key and value in the file, so a scheme that also appeared as a CFBundleName
 * or an ATS domain would satisfy a naive `includes()` while no callback was
 * registered at all.
 */
export function urlSchemes(plistPath: string): string[] | null {
  if (!existsSync(plistPath)) return null;
  const res = run("/usr/bin/plutil", ["-extract", "CFBundleURLTypes", "json", "-o", "-", plistPath]);
  // A non-zero exit here means the key is absent, which is a real answer:
  // no CFBundleURLTypes means no schemes are registered.
  if (!res.ok) return [];
  return parseUrlSchemes(res.stdout);
}

/** PURE. Schemes out of the JSON `plutil -extract CFBundleURLTypes json` prints. */
export function parseUrlSchemes(json: string): string[] | null {
  try {
    const types = JSON.parse(json) as Array<{ CFBundleURLSchemes?: string[] }>;
    if (!Array.isArray(types)) return null;
    return types.flatMap((t) => (Array.isArray(t?.CFBundleURLSchemes) ? t.CFBundleURLSchemes : []));
  } catch {
    return null;
  }
}

/**
 * True when the PNG carries an alpha channel — App Store Connect rejects those.
 *
 * Null when sips could not answer. Deliberately does NOT throw: this runs
 * inside a loop over every icon, and one unreadable file used to unwind the
 * whole command, discarding every check already gathered and printing a stack
 * trace instead of a report.
 */
export function pngHasAlpha(file: string): boolean | null {
  if (!existsSync(file)) return null;
  const res = run("/usr/bin/sips", ["-g", "hasAlpha", file]);
  if (!res.ok) return null;
  const m = res.stdout.match(/hasAlpha:\s*(\w+)/);
  return m ? m[1] === "yes" : null;
}

export interface PngSize { width: number; height: number }

export function pngSize(file: string): PngSize | null {
  if (!existsSync(file)) return null;
  const res = run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  if (!res.ok) return null;
  const w = res.stdout.match(/pixelWidth:\s*(\d+)/);
  const h = res.stdout.match(/pixelHeight:\s*(\d+)/);
  return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null;
}
