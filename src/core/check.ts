import { EXIT, type ExitCode } from './errors.js';

/**
 * The single abstraction the whole tool is built from. Every command — env,
 * git, inspect, validate — produces a list of these, and `doctor` is simply
 * the union of the others. That is what makes the command set extensible
 * without a plugin system.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip';

export interface CheckResult {
  /** Stable machine-readable identifier, e.g. `node.version`. */
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  /**
   * One-line human summary. Always populated and never colour-dependent:
   * every status is conveyed in words as well as in colour, so the output
   * is equally usable when piped, when NO_COLOR is set, and in a screen
   * reader.
   */
  readonly summary: string;
  /** Structured payload for `--json`. Must be JSON-serialisable. */
  readonly detail?: Readonly<Record<string, unknown>>;
  /** Actionable next step. Present whenever the status is `warn` or `fail`. */
  readonly remediation?: string;
}

export interface ReportSection {
  readonly title: string;
  readonly results: readonly CheckResult[];
}

export interface Report {
  readonly command: string;
  readonly version: string;
  readonly generatedAt: string;
  readonly sections: readonly ReportSection[];
}

/**
 * Severity order, worst last. Used for ranking and for the worst-status
 * reduction that produces the exit code.
 */
const SEVERITY: Readonly<Record<CheckStatus, number>> = {
  skip: 0,
  info: 1,
  pass: 2,
  warn: 3,
  fail: 4,
};

export function severityOf(status: CheckStatus): number {
  return SEVERITY[status];
}

/** Compares two statuses by severity; positive when `a` is worse than `b`. */
export function compareSeverity(a: CheckStatus, b: CheckStatus): number {
  return SEVERITY[a] - SEVERITY[b];
}

export function worstStatus(report: Report): CheckStatus {
  let worst: CheckStatus = 'pass';
  for (const section of report.sections) {
    for (const result of section.results) {
      if (compareSeverity(result.status, worst) > 0) {
        worst = result.status;
      }
    }
  }
  return worst;
}

/** Counts of each status across the whole report, for the summary line. */
export function tally(report: Report): Readonly<Record<CheckStatus, number>> {
  const counts: Record<CheckStatus, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    info: 0,
    skip: 0,
  };
  for (const section of report.sections) {
    for (const result of section.results) {
      counts[result.status] += 1;
    }
  }
  return counts;
}

/**
 * Exit code derivation: a single pure function over the report.
 *
 * Under `--strict`, a warning is promoted to a failure. That is the whole of
 * what `--strict` means, expressed once rather than in each check.
 */
export function exitCodeFor(report: Report, strict = false): ExitCode {
  const worst = worstStatus(report);
  if (worst === 'fail') return EXIT.FAILURE;
  if (strict && worst === 'warn') return EXIT.FAILURE;
  return EXIT.SUCCESS;
}

/** Orders results worst-first, then by id, so output is deterministic. */
export function bySeverityThenId(
  results: readonly CheckResult[],
): CheckResult[] {
  return [...results].sort((a, b) => {
    const bySeverity = compareSeverity(b.status, a.status);
    return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
  });
}
