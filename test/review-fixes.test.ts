/**
 * Regressions from the first code review of this package.
 *
 * Every case here is a green line, or a confident wrong diagnosis, that the
 * package printed while measuring nothing — which is the specific failure it
 * exists to prevent. They are pinned rather than trusted to the fix staying
 * obvious.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSettingValues } from "../src/lib/xcode.js";
import { parseUrlSchemes } from "../src/lib/xcode.js";
import { interpretProbe } from "../src/lib/signing.js";
import { loadConfig, ConfigError } from "../src/config.js";

describe("interpretProbe — a failed probe is not a keychain prompt", () => {
  /**
   * The old version returned `true` for any non-zero exit, so an expired
   * certificate, an untrusted identity, or codesign missing from PATH all
   * printed "keychain prompts on every signature" and a set-key-partition-list
   * fix, on a machine whose keychain was fine.
   */
  it("reports the watchdog kill (137) as a prompt", () => {
    const p = interpretProbe(137, 6000, 6000);
    expect(p.prompts).toBe(true);
    expect(p.detail).toMatch(/watchdog/);
  });

  it("reports any OTHER non-zero exit as UNMEASURED, not as a prompt", () => {
    for (const status of [1, 2, 127]) {
      const p = interpretProbe(status, 40, 6000);
      expect(p.prompts).toBeNull();
      expect(p.detail).toContain(`exited ${status}`);
    }
  });

  it("reports a fast success as no prompt, and says how fast", () => {
    const p = interpretProbe(0, 42, 6000);
    expect(p.prompts).toBe(false);
    expect(p.detail).toContain("42ms");
  });

  it("still catches a prompt that someone answered before the watchdog fired", () => {
    expect(interpretProbe(0, 5500, 6000).prompts).toBe(true);
  });
});

describe("parseUrlSchemes — scoped to CFBundleURLTypes", () => {
  it("returns the schemes actually registered", () => {
    const json = JSON.stringify([{ CFBundleURLName: "x", CFBundleURLSchemes: ["botguild", "bg"] }]);
    expect(parseUrlSchemes(json)).toEqual(["botguild", "bg"]);
  });

  it("does not invent a scheme from an entry that registers none", () => {
    expect(parseUrlSchemes(JSON.stringify([{ CFBundleURLName: "example" }]))).toEqual([]);
  });

  it("returns null on malformed output rather than an empty list", () => {
    // [] would read as "no schemes registered" — a measurement. null is "could
    // not read", which the caller reports differently.
    expect(parseUrlSchemes("not json")).toBeNull();
    expect(parseUrlSchemes(JSON.stringify({ nope: 1 }))).toBeNull();
  });
});

describe("buildSettingValues", () => {
  it("does not swallow following lines on a multi-line value", () => {
    // [^;]+ matches newlines, so a list value captured every line up to the
    // first semicolon and reported the lot as one value.
    const pbx = [
      "\t\t\t\tOTHER_LDFLAGS = (",
      '\t\t\t\t\t"-ObjC",',
      "\t\t\t\t);",
      "\t\t\t\tTARGETED_DEVICE_FAMILY = 1;",
    ].join("\n");
    expect(buildSettingValues(pbx, "TARGETED_DEVICE_FAMILY")).toEqual(new Set(["1"]));
    expect(buildSettingValues(pbx, "OTHER_LDFLAGS")).toEqual(new Set());
  });

  it("treats a regex-special key as a literal", () => {
    const pbx = "\t\t\t\tA.B = literal;\n\t\t\t\tAXB = other;";
    expect(buildSettingValues(pbx, "A.B")).toEqual(new Set(["literal"]));
  });
});

describe("deviceFamily validation", () => {
  const repo = (config: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), "appstore-kit-review-"));
    writeFileSync(join(dir, "appstore.config.json"), JSON.stringify(config));
    return dir;
  };
  const minimal = { bundleId: "ai.example.app", scheme: "E", appTarget: "E", deploymentTarget: "17.0" };

  it("rejects an inherited Object property", () => {
    // `family in DEVICE_FAMILY_VALUES` walked the prototype chain, so this
    // validated and then compared TARGETED_DEVICE_FAMILY against a function.
    for (const evil of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      expect(() => loadConfig(repo({ ...minimal, deviceFamily: evil }))).toThrow(ConfigError);
    }
  });

  it("still accepts the three real values", () => {
    for (const ok of ["iphone", "ipad", "universal"]) {
      expect(loadConfig(repo({ ...minimal, deviceFamily: ok })).config.deviceFamily).toBe(ok);
    }
  });
});
