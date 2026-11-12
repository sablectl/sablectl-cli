import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The version is read from the package manifest at runtime, never written as
 * a literal here. A literal is a second source of truth that drifts silently
 * the first time someone bumps the manifest and forgets this file.
 *
 * The manifest is found by walking up from this module's own location, so it
 * resolves correctly whether the code runs from `dist/`, from a release
 * tarball, or from a global install.
 */
function findManifest(start: string): string | undefined {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, 'package.json');
    try {
      const raw = readFileSync(candidate, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'name' in parsed &&
        parsed.name === 'sablectl'
      ) {
        return raw;
      }
    } catch {
      // Not here, or not readable. Keep walking.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function readVersion(): string {
  const raw = findManifest(dirname(fileURLToPath(import.meta.url)));
  if (raw === undefined) return '0.0.0-unknown';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      typeof parsed.version === 'string'
    ) {
      return parsed.version;
    }
  } catch {
    // Fall through to the sentinel below.
  }
  return '0.0.0-unknown';
}

/**
 * Resolved once per process. A sentinel rather than a throw: a missing
 * manifest should not stop `sablectl doctor` from diagnosing the machine.
 */
export const VERSION: string = readVersion();

export const PRODUCT_NAME = 'sablectl';
export const PRODUCT_SUBTITLE = 'Sable Developer Toolkit';
export const PRODUCT_TAGLINE =
  'Diagnostics, validation, and developer utilities.';
