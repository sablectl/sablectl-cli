/**
 * Narrowing helpers for the `--json` envelope.
 *
 * The tests parse the envelope as `unknown` and narrow it, for the same
 * reason the source does: a type assertion on external data is a lie that
 * would then hide a shape regression instead of reporting it.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseEnvelope(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error('JSON output is not an object');
  }
  return parsed;
}

export function recordAt(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value)) {
    throw new Error(`expected '${key}' to be an object`);
  }
  return value;
}

export function arrayAt(
  source: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error(`expected '${key}' to be an array`);
  }
  return value;
}

export function recordsAt(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  return arrayAt(source, key).map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`expected '${key}[${String(index)}]' to be an object`);
    }
    return item;
  });
}

export function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`expected '${key}' to be a string`);
  }
  return value;
}

/** Every `{ id, status }` pair in an envelope, flattened across sections. */
export function statusesById(
  envelope: Record<string, unknown>,
): Map<string, string> {
  const found = new Map<string, string>();
  for (const section of recordsAt(envelope, 'sections')) {
    for (const result of recordsAt(section, 'results')) {
      found.set(stringAt(result, 'id'), stringAt(result, 'status'));
    }
  }
  return found;
}
