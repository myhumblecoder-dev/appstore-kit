import { Report } from "../lib/report.js";
import { run, which } from "../lib/exec.js";
import { codesigningIdentities, keychainPromptsForSigning, teamIdsFromProfiles, PARTITION_LIST_FIX } from "../lib/signing.js";

export interface DoctorOptions { fix: boolean }

/**
 * Diagnose the machine, not the app.
 *
 * Every check here cost real time before it existed. None of them is
 * app-specific, which is exactly why they belong in a shared package rather
 * than in one repo's shell script.
 */
export async function doctor(opts: DoctorOptions): Promise<number> {
  const r = new Report();

  r.section("Toolchain");
  const xcodebuild = run("/usr/bin/xcodebuild", ["-version"]).stdout.split("\n")[0] ?? "";
  xcodebuild ? r.pass("xcodebuild", xcodebuild) : r.fail("xcodebuild", "not available");
  which("xcodegen") ? r.pass("xcodegen") : r.fail("xcodegen", "not installed — brew install xcodegen");

  r.section("Signing");
  const identities = codesigningIdentities();
  const dev = identities.filter((i) => i.kind === "development");
  const dist = identities.filter((i) => i.kind === "distribution");

  dev.length ? r.pass("Apple Development certificate", dev[0]!.name) : r.note("No Apple Development certificate — device builds will fail");

  if (dist.length) {
    r.pass("Apple Distribution certificate", dist[0]!.name);
  } else {
    r.fail(
      "Apple Distribution certificate",
      "absent — TestFlight and the App Store both require one. 'Apple Development' " +
      "signs builds for your own devices only; having it implies nothing about this. " +
      "Create it in Xcode > Settings > Apple Accounts > your team > Manage Certificates > + > Apple Distribution.",
    );
  }

  const teams = teamIdsFromProfiles();
  teams.length
    ? r.pass("team id (from provisioning profiles)", teams.join(", "))
    : r.fail("team id", "no provisioning profiles installed — open the project in Xcode once to create one");

  if (dist.length) {
    const prompts = keychainPromptsForSigning(dist[0]!.hash);
    if (prompts === false) {
      r.pass("keychain", "codesign uses the distribution key without prompting");
    } else if (prompts === true) {
      r.fail(
        "keychain prompts on every signature",
        "an archive signs several times and an unanswered prompt fails it as " +
        `errSecInternalComponent, hundreds of lines into the log. Fix once with:\n      ${PARTITION_LIST_FIX}`,
      );
    } else {
      r.note("Could not probe the keychain ACL");
    }
  }

  r.section("Simulators");
  const devices = run("/usr/bin/xcrun", ["simctl", "list", "devices", "available"]).stdout;
  const iphones = devices.split("\n").filter((l) => /^\s+iPhone/.test(l));
  iphones.length
    ? r.pass(`${iphones.length} iPhone simulator(s) available`)
    : r.fail("simulators", "none available — install a runtime via Xcode > Settings > Components");

  const daemon = run("/usr/bin/pgrep", ["-f", "CoreSimulatorService"]).ok;
  if (daemon) {
    r.pass("CoreSimulatorService running");
  } else if (opts.fix) {
    run("/usr/bin/xcrun", ["simctl", "list"]);
    r.pass("CoreSimulatorService", "started on demand");
  } else {
    r.note("CoreSimulatorService not running — it starts on demand, or run with --fix");
  }

  if (opts.fix) {
    r.section("Repairing simulator state");
    // "Launchd job spawn failed" and "Mach error -308 (ipc/mig) server died"
    // are two different wedges with one recovery: shut everything down and let
    // the daemon respawn. Both cost a silent, 3-second, zero-output test run.
    run("/usr/bin/killall", ["Simulator"]);
    run("/usr/bin/killall", ["-9", "com.apple.CoreSimulator.CoreSimulatorService"]);
    run("/usr/bin/xcrun", ["simctl", "shutdown", "all"]);
    r.pass("simulators shut down and daemon restarted");
  }

  r.section("App Store Connect credentials");
  const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
  if (ASC_KEY_ID && ASC_ISSUER_ID && ASC_KEY_PATH) {
    r.pass("ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH", `key ${ASC_KEY_ID}`);
  } else {
    const missing = [
      !ASC_KEY_ID && "ASC_KEY_ID", !ASC_ISSUER_ID && "ASC_ISSUER_ID", !ASC_KEY_PATH && "ASC_KEY_PATH",
    ].filter(Boolean).join(", ");
    r.note(`Not set: ${missing} — only \`appstore metadata\` needs these`);
  }

  process.stdout.write("\n");
  if (r.failed > 0) {
    process.stdout.write(`\x1b[31m${r.failed} problem(s) with this machine.\x1b[0m\n\n`);
    return 1;
  }
  process.stdout.write("\x1b[32mThis machine can build, sign and ship.\x1b[0m\n\n");
  return 0;
}
