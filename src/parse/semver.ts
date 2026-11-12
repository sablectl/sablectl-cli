/**
 * A small semantic-version implementation covering the subset this tool
 * needs: parsing, comparison, and the range operators that actually appear
 * in `engines.node` fields.
 *
 * `semver` as a dependency would be the obvious alternative. It is not worth
 * a transitive tree in a zero-dependency tool for the handful of operators
 * below, and the unsupported cases are reported honestly rather than
 * guessed at.
 */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
}

const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemVer(value: string): SemVer | undefined {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) return undefined;

  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
  };
}

export function isValidSemVer(value: string): boolean {
  return parseSemVer(value) !== undefined;
}

export function formatSemVer(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease === undefined
    ? core
    : `${core}-${version.prerelease}`;
}

/** Negative when `a < b`, zero when equal, positive when `a > b`. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  // A prerelease sorts below its release, per the specification.
  if (a.prerelease === undefined && b.prerelease === undefined) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export type RangeSupport = 'satisfied' | 'unsatisfied' | 'unsupported';

/**
 * Evaluates a version against a range.
 *
 * Supported: `*`, a bare version, `=`, `>`, `>=`, `<`, `<=`, `^`, `~`,
 * hyphen-free space-separated conjunctions (`>=20.19 <23`) and `||`
 * alternatives. Anything else returns `unsupported` — the caller then says
 * so, instead of reporting a pass it did not actually verify.
 */
export function satisfiesRange(version: string, range: string): RangeSupport {
  const target = parseSemVer(normaliseVersion(version));
  if (target === undefined) return 'unsupported';

  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === 'x') return 'satisfied';

  const alternatives = trimmed.split('||');
  let sawUnsupported = false;

  for (const alternative of alternatives) {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) continue;

    let allSatisfied = true;
    for (const comparator of comparators) {
      const outcome = evaluateComparator(target, comparator);
      if (outcome === 'unsupported') {
        sawUnsupported = true;
        allSatisfied = false;
        break;
      }
      if (outcome === 'unsatisfied') {
        allSatisfied = false;
        break;
      }
    }
    if (allSatisfied) return 'satisfied';
  }

  return sawUnsupported ? 'unsupported' : 'unsatisfied';
}

function evaluateComparator(target: SemVer, comparator: string): RangeSupport {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator);
  if (match === null) return 'unsupported';

  let operator = match[1] ?? '=';
  const rawVersion = match[2];
  if (rawVersion === undefined) return 'unsupported';

  // A partial version with no explicit operator is an X-range, not an exact
  // match: `18` means ">=18.0.0 <19.0.0", `18.20` means ">=18.20.0
  // <18.21.0". Treating them as equality would report Node 18.20.0 as
  // outside a range of "18", which is the sort of wrong answer that teaches
  // people to ignore the tool.
  if (match[1] === undefined) {
    const supplied = countVersionParts(rawVersion);
    if (supplied === 1) operator = '^';
    else if (supplied === 2) operator = '~';
  }

  const bound = parseSemVer(normaliseVersion(rawVersion));
  if (bound === undefined) return 'unsupported';

  const order = compareSemVer(target, bound);

  switch (operator) {
    case '>':
      return order > 0 ? 'satisfied' : 'unsatisfied';
    case '>=':
      return order >= 0 ? 'satisfied' : 'unsatisfied';
    case '<':
      return order < 0 ? 'satisfied' : 'unsatisfied';
    case '<=':
      return order <= 0 ? 'satisfied' : 'unsatisfied';
    case '=':
      return order === 0 ? 'satisfied' : 'unsatisfied';
    case '^': {
      // Compatible within the leftmost non-zero component.
      if (order < 0) return 'unsatisfied';
      if (bound.major > 0) {
        return target.major === bound.major ? 'satisfied' : 'unsatisfied';
      }
      if (bound.minor > 0) {
        return target.major === 0 && target.minor === bound.minor
          ? 'satisfied'
          : 'unsatisfied';
      }
      return compareSemVer(target, bound) === 0 ? 'satisfied' : 'unsatisfied';
    }
    case '~': {
      if (order < 0) return 'unsatisfied';
      return target.major === bound.major && target.minor === bound.minor
        ? 'satisfied'
        : 'unsatisfied';
    }
    default:
      return 'unsupported';
  }
}

/** How many components the author actually wrote: `18` → 1, `18.20` → 2. */
function countVersionParts(value: string): number {
  return value.trim().replace(/^v/, '').split('.').filter(Boolean).length;
}

/**
 * Accepts the partial forms that appear in real `engines` fields — `20`,
 * `20.19`, `v20.19.0` — and completes them to a full version.
 */
export function normaliseVersion(value: string): string {
  const cleaned = value.trim().replace(/^v/, '');
  const parts = cleaned.split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}
