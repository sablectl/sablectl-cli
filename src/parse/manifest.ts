import {
  isRecord,
  parseFailure,
  parsed,
  recordField,
  stringArrayField,
  stringField,
  type Parsed,
} from './result.js';

export interface Manifest {
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly description: string | undefined;
  readonly private: boolean;
  readonly type: string | undefined;
  readonly main: string | undefined;
  readonly types: string | undefined;
  readonly packageManager: string | undefined;
  readonly engines: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly workspaces: readonly string[];
  readonly files: readonly string[];
  /** Normalised `bin`: the string form becomes a single entry under `name`. */
  readonly bin: Readonly<Record<string, string>>;
  /** Every file path referenced by `exports`, flattened. */
  readonly exportPaths: readonly string[];
}

/**
 * Parses a `package.json` document.
 *
 * Nothing is assumed about the shape: a manifest with `scripts: "build"` or
 * `dependencies: null` is a real thing that occurs in the wild, and the
 * parser must survive it rather than throwing halfway through a report.
 */
export function parseManifest(path: string, raw: string): Parsed<Manifest> {
  if (raw.trim() === '') {
    return parseFailure(path, 'file is empty');
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    return parseFailure(path, reason);
  }

  if (!isRecord(document)) {
    return parseFailure(path, 'top-level value is not an object');
  }

  return parsed({
    name: stringField(document, 'name'),
    version: stringField(document, 'version'),
    description: stringField(document, 'description'),
    private: document['private'] === true,
    type: stringField(document, 'type'),
    main: stringField(document, 'main'),
    types: stringField(document, 'types'),
    packageManager: stringField(document, 'packageManager'),
    engines: stringMap(recordField(document, 'engines')),
    scripts: stringMap(recordField(document, 'scripts')),
    dependencies: stringMap(recordField(document, 'dependencies')),
    devDependencies: stringMap(recordField(document, 'devDependencies')),
    peerDependencies: stringMap(recordField(document, 'peerDependencies')),
    optionalDependencies: stringMap(
      recordField(document, 'optionalDependencies'),
    ),
    workspaces: parseWorkspaces(document['workspaces']),
    files: stringArrayField(document, 'files') ?? [],
    bin: parseBin(document),
    exportPaths: collectExportPaths(document['exports'], 0),
  });
}

function stringMap(
  source: Record<string, unknown> | undefined,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  if (source === undefined) return result;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/** `workspaces` is either an array of globs or `{ packages: [...] }`. */
function parseWorkspaces(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (isRecord(value)) {
    return stringArrayField(value, 'packages') ?? [];
  }
  return [];
}

function parseBin(
  document: Record<string, unknown>,
): Readonly<Record<string, string>> {
  const value = document['bin'];
  if (typeof value === 'string') {
    const name = stringField(document, 'name');
    return name === undefined ? { bin: value } : { [name]: value };
  }
  return stringMap(isRecord(value) ? value : undefined);
}

/**
 * `exports` is recursive and may nest conditions arbitrarily. Depth is
 * bounded, because a hand-written manifest can nest further than is
 * sensible and an unbounded walk on untrusted input is a hazard in itself.
 */
function collectExportPaths(value: unknown, depth: number): readonly string[] {
  if (depth > 6) return [];
  if (typeof value === 'string') return value.startsWith('.') ? [value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectExportPaths(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) =>
      collectExportPaths(item, depth + 1),
    );
  }
  return [];
}
