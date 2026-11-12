/**
 * External data is parsed, never asserted.
 *
 * Everything this tool reads — manifests, TypeScript configuration,
 * lockfiles, subprocess output, environment variables — comes from outside
 * the program and may be any shape at all. A type assertion on such a value
 * is a lie the compiler then propagates; a discriminated result forces every
 * caller to handle the malformed case explicitly.
 */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly path: string; readonly reason: string };
    };

export function parsed<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

export function parseFailure<T>(path: string, reason: string): Parsed<T> {
  return { ok: false, error: { path, reason } };
}

/** Narrowing helpers used by every parser in this directory. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

export function recordField(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

export function stringArrayField(
  source: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = source[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}
