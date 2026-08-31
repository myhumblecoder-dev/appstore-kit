import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Everything the toolkit needs to know about a specific app.
 *
 * The point of this file is that nothing downstream hardcodes an app's name,
 * bundle id, target or theme. The scripts this package replaces had roughly
 * thirty such literals between them, and every one was a reason the next app
 * would need a fork rather than a dependency.
 */
export interface AppStoreConfig {
  /** e.g. "ai.botguild.app". Must match the App ID any APNs topic is issued for. */
  bundleId: string;
  /** Directory holding the Xcode project, relative to the repo root. */
  projectDir: string;
  /** Xcode scheme to build and archive. */
  scheme: string;
  /** App target name; also the .xcodeproj and .app basename by convention. */
  appTarget: string;
  /** Minimum iOS version, as it appears in IPHONEOS_DEPLOYMENT_TARGET. */
  deploymentTarget: string;
  /**
   * Xcode's default is universal ("1,2"), which is never a deliberate choice.
   * Declaring it here is what lets `check` catch the default winning by silence.
   */
  deviceFamily: "iphone" | "ipad" | "universal";
  /** URL schemes the app must register, e.g. OAuth callbacks. */
  urlSchemes: string[];
  capabilities: {
    /** Requires the aps-environment entitlement. */
    push: boolean;
  };
  listing: { path: string };
  reviewNotes: { path: string };
  screenshots: {
    outDir: string;
    /** xcodebuild -only-testing target that captures the frames. */
    uiTest: string;
    /** Page background as #RRGGBB. Every frame is sampled against it. */
    themeBackground?: string;
    sizes: Array<{ slot: string; simulator: string }>;
  };
  checks: {
    /** Guideline 3.1.3(e): no in-app viewer for purchased content. */
    noInAppViewer: boolean;
    /** Guideline 4.8: files that must contain no third-party sign-in button. */
    noThirdPartySignIn: string[];
    /** Declaring UIBackgroundModes without a handler is a review flag. */
    noBackgroundModes: boolean;
  };
  /** Repo-specific commands run as part of a full `check`. */
  gates: string[];
}

const CONFIG_NAME = "appstore.config.json";

/** "1" iPhone, "2" iPad — the values Xcode writes into TARGETED_DEVICE_FAMILY. */
export const DEVICE_FAMILY_VALUES: Record<AppStoreConfig["deviceFamily"], string> = {
  iphone: "1",
  ipad: "2",
  universal: "1,2",
};

export class ConfigError extends Error {}

/** Walk up from `from` looking for the config, so the CLI works from any subdirectory. */
export function findConfig(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new ConfigError(
        `No ${CONFIG_NAME} found in ${from} or any parent directory.\n` +
        `Run \`appstore init\` to create one.`,
      );
    }
    dir = parent;
  }
}

function req<T>(value: T | undefined, path: string): T {
  if (value === undefined || value === null || value === "") {
    throw new ConfigError(`${CONFIG_NAME}: "${path}" is required`);
  }
  return value;
}

export interface LoadedConfig {
  config: AppStoreConfig;
  /** Absolute path to the repo root — the directory holding the config. */
  root: string;
  /** Resolve a config-relative path against the repo root. */
  path(p: string): string;
}

export function loadConfig(from?: string): LoadedConfig {
  const file = findConfig(from);
  const root = dirname(file);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }

  const r = raw as Partial<AppStoreConfig>;
  const family = r.deviceFamily ?? "iphone";
  if (!(family in DEVICE_FAMILY_VALUES)) {
    throw new ConfigError(
      `${CONFIG_NAME}: "deviceFamily" must be one of ${Object.keys(DEVICE_FAMILY_VALUES).join(", ")}, got "${family}"`,
    );
  }

  const screenshots = r.screenshots ?? ({} as AppStoreConfig["screenshots"]);
  const bg = screenshots.themeBackground;
  if (bg !== undefined && !/^#[0-9a-fA-F]{6}$/.test(bg)) {
    throw new ConfigError(`${CONFIG_NAME}: "screenshots.themeBackground" must be #RRGGBB, got "${bg}"`);
  }

  const config: AppStoreConfig = {
    bundleId: req(r.bundleId, "bundleId"),
    projectDir: r.projectDir ?? "ios",
    scheme: req(r.scheme, "scheme"),
    appTarget: req(r.appTarget, "appTarget"),
    deploymentTarget: req(r.deploymentTarget, "deploymentTarget"),
    deviceFamily: family,
    urlSchemes: r.urlSchemes ?? [],
    capabilities: { push: r.capabilities?.push ?? false },
    listing: { path: r.listing?.path ?? "ios/STORE-LISTING.md" },
    reviewNotes: { path: r.reviewNotes?.path ?? "ios/REVIEW-NOTES.md" },
    screenshots: {
      outDir: screenshots.outDir ?? "ios/appstore",
      uiTest: screenshots.uiTest ?? "",
      themeBackground: bg,
      sizes: screenshots.sizes ?? [],
    },
    checks: {
      noInAppViewer: r.checks?.noInAppViewer ?? true,
      noThirdPartySignIn: r.checks?.noThirdPartySignIn ?? [],
      noBackgroundModes: r.checks?.noBackgroundModes ?? true,
    },
    gates: r.gates ?? [],
  };

  return {
    config,
    root,
    path: (p: string) => (isAbsolute(p) ? p : join(root, p)),
  };
}
