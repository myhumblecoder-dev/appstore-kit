import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError, DEVICE_FAMILY_VALUES } from "../src/config.js";

function repo(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "appstore-kit-test-"));
  writeFileSync(join(dir, "appstore.config.json"), JSON.stringify(config));
  return dir;
}

const minimal = {
  bundleId: "ai.example.app",
  scheme: "Example",
  appTarget: "Example",
  deploymentTarget: "17.0",
};

describe("loadConfig", () => {
  it("defaults deviceFamily to iphone rather than inheriting Xcode's universal default", () => {
    const { config } = loadConfig(repo(minimal));
    expect(config.deviceFamily).toBe("iphone");
    expect(DEVICE_FAMILY_VALUES[config.deviceFamily]).toBe("1");
  });

  it("names the missing field", () => {
    expect(() => loadConfig(repo({ scheme: "Example" })))
      .toThrow(/"bundleId" is required/);
  });

  it("rejects a deviceFamily outside the three Xcode understands", () => {
    expect(() => loadConfig(repo({ ...minimal, deviceFamily: "phone" })))
      .toThrow(/must be one of iphone, ipad, universal/);
  });

  /** A malformed colour would otherwise fail later, inside a pixel comparison. */
  it("rejects a themeBackground that is not #RRGGBB", () => {
    expect(() => loadConfig(repo({ ...minimal, screenshots: { themeBackground: "020617" } })))
      .toThrow(/must be #RRGGBB/);
  });

  it("finds the config from a subdirectory", () => {
    const root = repo(minimal);
    const nested = join(root, "ios", "Tools");
    mkdirSync(nested, { recursive: true });
    expect(loadConfig(nested).root).toBe(root);
  });

  it("explains itself when there is no config at all", () => {
    expect(() => loadConfig(mkdtempSync(join(tmpdir(), "empty-")))).toThrow(ConfigError);
    expect(() => loadConfig(mkdtempSync(join(tmpdir(), "empty-")))).toThrow(/appstore init/);
  });
});
