import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSettingValues, buildSettingIs } from "../src/lib/xcode.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("buildSettingValues", () => {
  /**
   * The regression this package exists for. A universal binary makes iPad
   * screenshots a required upload and puts the app in front of a reviewer on a
   * device it was never opened on — and it happens by DEFAULT, with every test
   * green, because nobody types "1,2".
   */
  it("catches a universal target hiding behind a fixed one", () => {
    const values = buildSettingValues(fixture("universal.pbxproj"), "TARGETED_DEVICE_FAMILY");
    expect(values).toEqual(new Set(["1", "1,2"]));
    expect(buildSettingIs(fixture("universal.pbxproj"), "TARGETED_DEVICE_FAMILY", "1")).toBe(false);
  });

  it("passes when every target agrees", () => {
    expect(buildSettingIs(fixture("iphone-only.pbxproj"), "TARGETED_DEVICE_FAMILY", "1")).toBe(true);
  });

  /**
   * Absent is not the same as correct. An unset setting is precisely the
   * failure mode — Xcode supplies the universal default and the project file
   * says nothing at all.
   */
  it("does not treat an unset setting as satisfied", () => {
    expect(buildSettingValues(fixture("unset.pbxproj"), "TARGETED_DEVICE_FAMILY").size).toBe(0);
    expect(buildSettingIs(fixture("unset.pbxproj"), "TARGETED_DEVICE_FAMILY", "1")).toBe(false);
  });

  it("strips the quotes Xcode adds to values containing a comma", () => {
    expect(buildSettingValues(`TARGETED_DEVICE_FAMILY = "1,2";`, "TARGETED_DEVICE_FAMILY"))
      .toEqual(new Set(["1,2"]));
  });

  it("collects every distinct bundle id, so a test bundle cannot masquerade as the app", () => {
    expect(buildSettingValues(fixture("universal.pbxproj"), "PRODUCT_BUNDLE_IDENTIFIER"))
      .toEqual(new Set(["ai.example.app", "ai.example.app.uitests"]));
  });
});
