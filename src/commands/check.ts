import { join } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { DEVICE_FAMILY_VALUES, loadConfig } from "../config.js";
import { Report } from "../lib/report.js";
import {
  buildSettingValues, plistHasKey, plistText, plistValue, pngHasAlpha, urlSchemes, xcodegen,
} from "../lib/xcode.js";
import { run } from "../lib/exec.js";

/** Source patterns that would break a 3.1.3(e) argument if they ever appeared. */
const IN_APP_VIEWERS = /QLPreview|WKWebView|SFSafariViewController|AVPlayer|QuickLook/;
/** A social sign-in button pulls an app into guideline 4.8 with no other change. */
const THIRD_PARTY_SIGN_IN = /Sign in with (Apple|Google|Facebook)|ASAuthorizationAppleID|GIDSignIn/;

export interface CheckOptions {
  /** Skip anything needing the network or a full build — the CI half. */
  static: boolean;
}

export async function check(opts: CheckOptions): Promise<number> {
  const { config: c, root, path } = loadConfig();
  const r = new Report();
  const projectDir = path(c.projectDir);

  r.section("Generating the project");
  const gen = xcodegen(projectDir);
  gen.ok ? r.pass("xcodegen generate") : r.fail("xcodegen generate", gen.detail);

  const pbxPath = join(projectDir, `${c.appTarget}.xcodeproj`, "project.pbxproj");
  const plist = join(projectDir, c.appTarget, "Info.plist");
  const ents = join(projectDir, c.appTarget, `${c.appTarget}.entitlements`);

  r.section("Build settings");
  if (!existsSync(pbxPath)) {
    r.fail("project.pbxproj", `not found at ${pbxPath}`);
  } else {
    const pbx = readFileSync(pbxPath, "utf8");

    // The defect this package exists for. Xcode's default is "1,2" and nobody
    // types it, so a universal binary ships while the review notes promise
    // iPhone only — which makes iPad screenshots a required upload and puts the
    // app in front of a reviewer on a device it was never opened on.
    const families = buildSettingValues(pbx, "TARGETED_DEVICE_FAMILY");
    const wantFamily = DEVICE_FAMILY_VALUES[c.deviceFamily];
    const seen = families.size ? [...families].join(", ") : "(unset — Xcode defaults to universal)";
    if (families.size === 1 && families.has(wantFamily)) {
      r.pass(`device family ${c.deviceFamily}`, `TARGETED_DEVICE_FAMILY = ${seen}`);
    } else {
      r.fail(
        `device family must be ${c.deviceFamily} (TARGETED_DEVICE_FAMILY = ${wantFamily})`,
        `${seen} — every target must agree, including test bundles`,
      );
    }

    // Both of these pass when ANY target carries the value — test bundles
    // legitimately differ — so the observed slot prints every value found, not
    // the configured one. Printing `c.bundleId` on the pass path echoed the
    // config back and hid a project whose app target had drifted while some
    // other target still matched.
    const ids = buildSettingValues(pbx, "PRODUCT_BUNDLE_IDENTIFIER");
    ids.has(c.bundleId)
      ? r.pass("bundle id", [...ids].join(", "))
      : r.fail("bundle id", `${[...ids].join(", ") || "(none)"} — expected ${c.bundleId}`);

    const targets = buildSettingValues(pbx, "IPHONEOS_DEPLOYMENT_TARGET");
    targets.has(c.deploymentTarget)
      ? r.pass("deployment target", [...targets].join(", "))
      : r.fail("deployment target", `${[...targets].join(", ") || "(none)"} — expected ${c.deploymentTarget}`);
  }

  r.section("Info.plist");
  // Without this every upload stops to ask the export-compliance question.
  r.expect("ITSAppUsesNonExemptEncryption", plistValue(plist, "ITSAppUsesNonExemptEncryption"), "false");

  if (c.checks.noBackgroundModes) {
    plistHasKey(plist, "UIBackgroundModes")
      ? r.fail("UIBackgroundModes", "declared — without a handler this is a review flag")
      : r.pass("no UIBackgroundModes");
  }

  // Scoped to CFBundleURLTypes, not a substring search of the whole plist. The
  // dump contains every key and value, so a scheme that happened to match a
  // CFBundleName or an ATS domain satisfied the old check while the callback
  // was never registered.
  const registered = urlSchemes(plist);
  for (const scheme of c.urlSchemes) {
    if (registered === null) {
      r.fail(`URL scheme ${scheme}://`, `could not read CFBundleURLTypes from ${plist}`);
    } else if (registered.includes(scheme)) {
      r.pass(`URL scheme ${scheme}://`, `CFBundleURLSchemes = ${registered.join(", ")}`);
    } else {
      r.fail(
        `URL scheme ${scheme}://`,
        `CFBundleURLSchemes = ${registered.join(", ") || "(none)"} — a callback has nothing to match on`,
      );
    }
  }

  if (c.capabilities.push) {
    r.section("Entitlements");
    plistText(ents).includes("aps-environment")
      ? r.pass("aps-environment", "present (signing rewrites it to production)")
      : r.fail("aps-environment", "missing — the build cannot receive push");
  }

  r.section("App icon");
  const iconDir = join(projectDir, c.appTarget, "Resources/Assets.xcassets/AppIcon.appiconset");
  const icons = existsSync(iconDir) ? readdirSync(iconDir).filter((f) => f.endsWith(".png")) : [];
  if (!icons.length) {
    r.fail("app icon", `no PNG in ${iconDir}`);
  } else {
    for (const icon of icons) {
      const alpha = pngHasAlpha(join(iconDir, icon));
      if (alpha === false) {
        r.pass(`${icon} has no alpha channel`, "sips hasAlpha: no");
      } else if (alpha === true) {
        r.fail(`${icon} alpha channel`, "present — App Store Connect rejects the upload outright");
      } else {
        // null means sips could not be read, which is not the same as alpha
        // being present. Saying "present" would assert a measurement never made.
        r.fail(`${icon} alpha channel`, "could not be read by sips — unverified, treat as unfit to submit");
      }
    }
  }

  r.section("Guideline arguments that are properties of the source");
  if (c.checks.noInAppViewer) {
    const scan = grepTree(projectDir, IN_APP_VIEWERS);
    if (scan.error) {
      r.fail("could not search for an in-app content viewer", scan.error);
    } else if (scan.scanned === 0) {
      // Zero files searched is not zero matches. Passing here would print a
      // green guideline argument backed by nothing.
      r.fail("no .swift files to search for an in-app content viewer", `none found under ${projectDir}`);
    } else if (scan.hits.length === 0) {
      r.pass("no in-app content viewer", `0 hits in ${scan.scanned} .swift files under ${c.projectDir}`);
    } else {
      r.fail("an in-app content viewer appeared", `${scan.hits.join(", ")} (of ${scan.scanned} .swift files)`);
    }
  }
  for (const file of c.checks.noThirdPartySignIn) {
    const full = path(file);
    const src = existsSync(full) ? readFileSync(full, "utf8") : "";
    THIRD_PARTY_SIGN_IN.test(src)
      ? r.fail(`third-party sign-in in ${file}`, "triggers 4.8 (Sign in with Apple required)")
      : r.pass(`no third-party sign-in in ${file}`);
  }

  if (!opts.static && c.gates.length) {
    r.section("Repo gates");
    for (const gate of c.gates) {
      const res = run("/bin/sh", ["-c", gate], { cwd: root });
      res.ok
        ? r.pass(gate)
        : r.fail(gate, lastMeaningfulLine(res.stdout + res.stderr));
    }
  }

  process.stdout.write("\n");
  if (r.failed > 0) {
    process.stdout.write(`\x1b[31m${r.failed} of ${r.total} checks failed. Do not submit this build.\x1b[0m\n\n`);
    return 1;
  }
  process.stdout.write(`\x1b[32mAll ${r.total} checks passed.\x1b[0m${opts.static ? " (static only — run without --static before submitting)" : ""}\n\n`);
  return 0;
}

interface Scan {
  /** Files whose contents match, relative to `dir`. */
  hits: string[];
  /** How many .swift files were actually read. */
  scanned: number;
  /** Set when grep itself failed, rather than simply finding nothing. */
  error: string | null;
}

/**
 * Files under `dir` whose contents match `pattern`, excluding build output.
 *
 * Reports the SEARCH SPACE alongside the hits, and separates "found nothing"
 * from "could not look". grep exits 1 with no output when there are no matches
 * and 2 when the path is wrong or unreadable — both of which used to arrive
 * here as an empty stdout, indistinguishable from a clean tree. A guideline
 * argument that "holds" because a typo'd projectDir matched zero files is the
 * exact defect this package exists to catch.
 */
function grepTree(dir: string, pattern: RegExp): Scan {
  const files = run("/usr/bin/find", [
    dir, "-name", "*.swift",
    "-not", "-path", "*/.build/*",
    "-not", "-path", "*/DerivedData/*",
  ]);
  const scanned = files.stdout.split("\n").filter(Boolean).length;

  const res = run("/usr/bin/grep", ["-rlE", pattern.source, dir, "--include=*.swift"]);
  // 0 = matched, 1 = no match. Anything else is grep failing, not a clean tree.
  if (res.status !== 0 && res.status !== 1) {
    return { hits: [], scanned, error: (res.stderr || `grep exited ${res.status}`).trim().slice(0, 200) };
  }

  const hits = res.stdout.split("\n").filter(Boolean)
    .filter((f) => !f.includes("/.build/") && !f.includes("/DerivedData/"))
    .map((f) => f.replace(`${dir}/`, ""));
  return { hits, scanned, error: null };
}

function lastMeaningfulLine(out: string): string {
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(-3).join(" / ").slice(0, 200) || "(no output)";
}
