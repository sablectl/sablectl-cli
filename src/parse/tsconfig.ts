import {
  isRecord,
  parseFailure,
  parsed,
  recordField,
  stringField,
  type Parsed,
} from './result.js';

export interface TsConfig {
  readonly strict: boolean | undefined;
  readonly target: string | undefined;
  readonly module: string | undefined;
  readonly moduleResolution: string | undefined;
  readonly extends: string | undefined;
  readonly outDir: string | undefined;
  /** Strict-family options set explicitly, for the detail payload. */
  readonly strictFamily: Readonly<Record<string, boolean>>;
}

const STRICT_FAMILY = [
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitThis',
  'useUnknownInCatchVariables',
  'alwaysStrict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
] as const;

/**
 * Parses `tsconfig.json`.
 *
 * TypeScript configuration is JSONC: comments and trailing commas are legal
 * and common. `JSON.parse` rejects both, so they are stripped first — with
 * string literals respected, so a comment marker inside a path value is not
 * mistaken for a comment.
 */
export function parseTsConfig(path: string, raw: string): Parsed<TsConfig> {
  if (raw.trim() === '') {
    return parseFailure(path, 'file is empty');
  }

  let document: unknown;
  try {
    document = JSON.parse(stripJsonComments(raw));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    return parseFailure(path, reason);
  }

  if (!isRecord(document)) {
    return parseFailure(path, 'top-level value is not an object');
  }

  const compilerOptions = recordField(document, 'compilerOptions') ?? {};
  const strictFamily: Record<string, boolean> = {};
  for (const key of STRICT_FAMILY) {
    const value = compilerOptions[key];
    if (typeof value === 'boolean') strictFamily[key] = value;
  }

  const strictValue = compilerOptions['strict'];

  return parsed({
    strict: typeof strictValue === 'boolean' ? strictValue : undefined,
    target: stringField(compilerOptions, 'target'),
    module: stringField(compilerOptions, 'module'),
    moduleResolution: stringField(compilerOptions, 'moduleResolution'),
    extends: stringField(document, 'extends'),
    outDir: stringField(compilerOptions, 'outDir'),
    strictFamily,
  });
}

/**
 * Removes `//` and block comments and trailing commas, leaving string
 * literals untouched. A character-level scan rather than a regular
 * expression, because a regular expression cannot tell a comment marker
 * inside a string from a real one.
 */
export function stripJsonComments(input: string): string {
  let output = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index);
    const next = input.charAt(index + 1);

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  // Trailing commas, now that comments can no longer hide one.
  return output.replace(/,(\s*[}\]])/g, '$1');
}
