import type { CheckStatus } from '../check.js';

/**
 * Colour decisions, made once and in one place.
 *
 * Colour is decoration only. Every status is also stated in words, so output
 * with colour disabled carries exactly the same information — which is the
 * accessibility requirement, not a nicety.
 */
export interface OutputStyle {
  readonly color: boolean;
  readonly verbose: boolean;
  readonly width: number;
}

export interface TerminalCapabilities {
  readonly isTTY: boolean;
  readonly columns: number | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolution order, and why:
 *
 * 1. An explicit `--no-color` flag always wins.
 * 2. `NO_COLOR` (any value, per the no-color.org convention) disables it.
 * 3. `TERM=dumb` disables it.
 * 4. `FORCE_COLOR` re-enables it even when stdout is not a TTY — this is how
 *    a CI job gets coloured logs deliberately.
 * 5. Otherwise colour follows TTY detection, so piped output is plain.
 *
 * CI is not treated as a colour signal on its own: many CI systems render
 * ANSI correctly, and suppressing colour there by default would be guessing.
 * Piped output is already covered by the TTY rule.
 */
export function resolveStyle(
  caps: TerminalCapabilities,
  options: { readonly noColor?: boolean; readonly verbose?: boolean } = {},
): OutputStyle {
  const { env } = caps;
  const verbose = options.verbose === true;
  const width = clampWidth(caps.columns);

  if (options.noColor === true) return { color: false, verbose, width };
  if (isSet(env['NO_COLOR'])) return { color: false, verbose, width };
  if (env['TERM'] === 'dumb') return { color: false, verbose, width };
  if (isSet(env['FORCE_COLOR'])) return { color: true, verbose, width };

  return { color: caps.isTTY, verbose, width };
}

/**
 * `NO_COLOR` and `FORCE_COLOR` are set-or-unset signals by convention, but
 * `FORCE_COLOR=0` is widely understood to mean "off", so it is honoured.
 */
function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0';
}

function clampWidth(columns: number | undefined): number {
  if (columns === undefined || !Number.isFinite(columns) || columns <= 0) {
    return 80;
  }
  return Math.max(40, Math.min(120, Math.trunc(columns)));
}

const CODES = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  grey: '\u001B[90m',
} as const;

type ColorName = keyof typeof CODES;

export function paint(
  style: OutputStyle,
  color: ColorName,
  value: string,
): string {
  if (!style.color) return value;
  return `${CODES[color]}${value}${CODES.reset}`;
}

/**
 * The word form of a status. This is the primary signal; colour merely
 * reinforces it. Fixed width so columns align without padding logic in the
 * renderer.
 */
export const STATUS_LABEL: Readonly<Record<CheckStatus, string>> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  info: 'INFO',
  skip: 'SKIP',
};

const STATUS_COLOR: Readonly<Record<CheckStatus, ColorName>> = {
  pass: 'green',
  warn: 'yellow',
  fail: 'red',
  info: 'blue',
  skip: 'grey',
};

export function statusLabel(style: OutputStyle, status: CheckStatus): string {
  return paint(style, STATUS_COLOR[status], STATUS_LABEL[status]);
}
