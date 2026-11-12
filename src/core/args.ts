import { UsageError } from './errors.js';

/**
 * A hand-written parser, deliberately.
 *
 * The alternative is a dependency whose transitive tree ships inside a tool
 * people run on their own machines, in exchange for roughly the amount of
 * code below. For a zero-dependency CLI that trade does not pay.
 */
export type FlagType = 'boolean' | 'string';

export interface FlagSpec {
  readonly name: string;
  readonly short?: string;
  readonly type: FlagType;
  readonly description: string;
  /** Placeholder shown in help for string flags, e.g. `<path>`. */
  readonly value?: string;
}

export interface ParsedFlags {
  readonly booleans: ReadonlyMap<string, boolean>;
  readonly strings: ReadonlyMap<string, string>;
}

export interface ParsedArgs {
  /** The command name, or `undefined` when none was given. */
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly flags: ParsedFlags;
}

export function flag(flags: ParsedFlags, name: string): boolean {
  return flags.booleans.get(name) ?? false;
}

export function option(flags: ParsedFlags, name: string): string | undefined {
  return flags.strings.get(name);
}

/**
 * Flags accepted by every command. Declared once so help output and
 * validation cannot disagree about what is global.
 */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: 'help', short: 'h', type: 'boolean', description: 'Show help.' },
  {
    name: 'version',
    short: 'V',
    type: 'boolean',
    description: 'Show the installed version.',
  },
  {
    name: 'json',
    type: 'boolean',
    description: 'Emit a machine-readable JSON report.',
  },
  {
    name: 'verbose',
    short: 'v',
    type: 'boolean',
    description: 'Include structured detail for each check.',
  },
  {
    name: 'no-color',
    type: 'boolean',
    description: 'Disable colour. NO_COLOR and a non-TTY stdout do the same.',
  },
];

/**
 * Parses `argv` (without `node` and the script path) against the global
 * flags plus whatever the selected command declares.
 *
 * `--` ends flag parsing; everything after it is a positional. An unknown
 * flag is a usage error rather than a silently ignored argument: silently
 * ignoring a mistyped flag is how a CI job passes while checking nothing.
 */
export function parseArgs(
  argv: readonly string[],
  lookup: (command: string) => readonly FlagSpec[] | undefined,
): ParsedArgs {
  const booleans = new Map<string, boolean>();
  const strings = new Map<string, string>();
  const positionals: string[] = [];

  let command: string | undefined;
  let specs = [...GLOBAL_FLAGS];
  let endOfFlags = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (endOfFlags) {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      endOfFlags = true;
      continue;
    }

    if (token.startsWith('--')) {
      index = consumeLong(token, argv, index, specs, booleans, strings);
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      index = consumeShort(token, argv, index, specs, booleans, strings);
      continue;
    }

    if (command === undefined) {
      command = token;
      const commandFlags = lookup(token);
      if (commandFlags !== undefined) {
        specs = [...GLOBAL_FLAGS, ...commandFlags];
      }
      continue;
    }

    positionals.push(token);
  }

  return {
    command,
    positionals,
    flags: { booleans, strings },
  };
}

function findSpec(
  specs: readonly FlagSpec[],
  predicate: (spec: FlagSpec) => boolean,
): FlagSpec | undefined {
  return specs.find(predicate);
}

function consumeLong(
  token: string,
  argv: readonly string[],
  index: number,
  specs: readonly FlagSpec[],
  booleans: Map<string, boolean>,
  strings: Map<string, string>,
): number {
  const body = token.slice(2);
  const equals = body.indexOf('=');
  const name = equals === -1 ? body : body.slice(0, equals);
  const inlineValue = equals === -1 ? undefined : body.slice(equals + 1);

  // `--no-x` is accepted as the negation of a declared boolean `x`, except
  // where `no-x` is itself a declared flag (`--no-color`).
  const direct = findSpec(specs, (spec) => spec.name === name);
  if (direct === undefined && name.startsWith('no-')) {
    const negated = findSpec(
      specs,
      (spec) => spec.name === name.slice(3) && spec.type === 'boolean',
    );
    if (negated !== undefined) {
      booleans.set(negated.name, false);
      return index;
    }
  }

  if (direct === undefined) {
    throw new UsageError(
      `unknown option '--${name}'`,
      suggestFlag(name, specs),
    );
  }

  if (direct.type === 'boolean') {
    if (inlineValue !== undefined) {
      throw new UsageError(`option '--${name}' does not take a value`);
    }
    booleans.set(direct.name, true);
    return index;
  }

  if (inlineValue !== undefined) {
    strings.set(direct.name, inlineValue);
    return index;
  }

  const next = argv[index + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new UsageError(
      `option '--${name}' requires a value`,
      `try '--${name} ${direct.value ?? '<value>'}'`,
    );
  }
  strings.set(direct.name, next);
  return index + 1;
}

function consumeShort(
  token: string,
  argv: readonly string[],
  index: number,
  specs: readonly FlagSpec[],
  booleans: Map<string, boolean>,
  strings: Map<string, string>,
): number {
  const letters = token.slice(1);
  let cursor = index;

  for (let position = 0; position < letters.length; position += 1) {
    const letter = letters[position];
    if (letter === undefined) continue;

    const spec = findSpec(specs, (candidate) => candidate.short === letter);
    if (spec === undefined) {
      throw new UsageError(`unknown option '-${letter}'`);
    }

    if (spec.type === 'boolean') {
      booleans.set(spec.name, true);
      continue;
    }

    // A string short flag consumes the rest of the cluster, or the next
    // argument when the cluster ends here.
    const rest = letters.slice(position + 1);
    if (rest !== '') {
      strings.set(spec.name, rest);
      return cursor;
    }
    const next = argv[cursor + 1];
    if (next === undefined || next.startsWith('-')) {
      throw new UsageError(`option '-${letter}' requires a value`);
    }
    strings.set(spec.name, next);
    cursor += 1;
    return cursor;
  }

  return cursor;
}

function suggestFlag(
  name: string,
  specs: readonly FlagSpec[],
): string | undefined {
  const match = closestMatch(
    name,
    specs.map((spec) => spec.name),
  );
  return match === undefined ? undefined : `did you mean '--${match}'?`;
}

/**
 * Damerau-style edit distance, capped: a suggestion is only offered when the
 * candidate is close enough that it is probably a typo. Suggesting something
 * unrelated is worse than suggesting nothing.
 */
export function editDistance(a: string, b: string): number {
  const cols = b.length + 1;

  // Three rolling rows rather than a full matrix: the transposition rule
  // needs the row before last, and nothing older. Typed arrays also remove
  // the possibly-undefined element access that a nested array would bring.
  let beforePrevious = new Uint32Array(cols);
  let previous = new Uint32Array(cols);
  let current = new Uint32Array(cols);

  for (let j = 0; j < cols; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const substitution = (previous[j - 1] ?? 0) + cost;
      let value = Math.min(deletion, insertion, substitution);
      if (
        i > 1 &&
        j > 1 &&
        a.charAt(i - 1) === b.charAt(j - 2) &&
        a.charAt(i - 2) === b.charAt(j - 1)
      ) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1);
      }
      current[j] = value;
    }

    const rotated = beforePrevious;
    beforePrevious = previous;
    previous = current;
    current = rotated;
  }

  return previous[b.length] ?? 0;
}

export function closestMatch(
  input: string,
  candidates: readonly string[],
): string | undefined {
  const threshold = Math.max(2, Math.floor(input.length / 3));
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= threshold ? best : undefined;
}
