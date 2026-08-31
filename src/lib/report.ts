/**
 * A check reports what it MEASURED, never what it expected.
 *
 * Three separate failures in the session that produced this package were tools
 * asserting things they never read: a hardcoded version string, a hardcoded
 * "App Store Connect wants 1320x2868" footer printed under differently-sized
 * files, and a log tail that read as success while the run had died and left
 * stale output on disk. Each one looked like confirmation. So `pass` and `fail`
 * both take the observed value, and there is no way to print a verdict without
 * having something to show for it.
 */
export class Report {
  private failures = 0;
  private checks = 0;

  section(title: string): void {
    process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
  }

  /** @param observed what was actually read — printed so a green line is auditable. */
  pass(label: string, observed?: string): void {
    this.checks++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${label}${observed ? `  \x1b[2m${observed}\x1b[0m` : ""}\n`);
  }

  fail(label: string, observed?: string): void {
    this.checks++;
    this.failures++;
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${label}${observed ? `\n      observed: ${observed}` : ""}\n`);
  }

  /** Assert an observed value equals an expected one, showing both either way. */
  expect(label: string, observed: string | null, expected: string): boolean {
    if (observed === expected) {
      this.pass(label, observed);
      return true;
    }
    this.fail(label, `${observed ?? "(absent)"} — expected ${expected}`);
    return false;
  }

  note(text: string): void {
    process.stdout.write(`  \x1b[33m•\x1b[0m ${text}\n`);
  }

  get failed(): number { return this.failures; }
  get total(): number { return this.checks; }
}
