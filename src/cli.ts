#!/usr/bin/env node
import { check } from "./commands/check.js";
import { doctor } from "./commands/doctor.js";
import { ConfigError } from "./config.js";

const USAGE = `appstore — App Store submission toolkit for native iOS apps

  appstore check [--static]   Gate a build against the App Store rules that are
                              properties of the binary. --static skips the
                              network and repo gates, for CI.
  appstore doctor [--fix]     Diagnose this machine: certificates, team id,
                              keychain ACL, simulators, credentials.
                              --fix repairs simulator state.

Configuration lives in appstore.config.json, found by walking up from the
working directory.
`;

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const has = (flag: string) => rest.includes(flag);

  switch (command) {
    case "check":  return check({ static: has("--static") });
    case "doctor": return doctor({ fix: has("--fix") });
    case undefined:
    case "-h":
    case "--help":
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`Unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    // A missing or malformed config is a user error with a clear fix; anything
    // else is a bug here and deserves its stack.
    if (err instanceof ConfigError) {
      process.stderr.write(`\n${err.message}\n\n`);
      process.exit(2);
    }
    process.stderr.write(`\n${err instanceof Error ? err.stack : String(err)}\n\n`);
    process.exit(2);
  });
