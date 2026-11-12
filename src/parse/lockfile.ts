/**
 * Package-manager detection from lockfiles.
 *
 * The lockfile is the strongest available evidence: it is produced by the
 * tool that actually installed the tree, whereas `packageManager` only
 * records an intention that may never have been honoured. When the two
 * disagree, that disagreement is itself worth reporting.
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno';

export interface LockfileMarker {
  readonly file: string;
  readonly manager: PackageManager;
}

export const LOCKFILES: readonly LockfileMarker[] = [
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'deno.lock', manager: 'deno' },
];

export interface LockfileDetection {
  readonly managers: readonly PackageManager[];
  readonly files: readonly string[];
}

/**
 * Detects every lockfile present, not merely the first. More than one is a
 * finding in its own right: two package managers have each installed the
 * tree and the two will disagree about what is installed.
 */
export function detectFromLockfiles(
  presentFiles: readonly string[],
): LockfileDetection {
  const files: string[] = [];
  const managers: PackageManager[] = [];

  for (const marker of LOCKFILES) {
    if (!presentFiles.includes(marker.file)) continue;
    files.push(marker.file);
    if (!managers.includes(marker.manager)) managers.push(marker.manager);
  }

  return { managers, files };
}

/**
 * Reads the manager out of a `packageManager` field (`pnpm@9.1.0`), which
 * Corepack uses. Returns `undefined` for anything unrecognised rather than
 * guessing from a prefix.
 */
export function managerFromField(
  value: string | undefined,
): PackageManager | undefined {
  if (value === undefined) return undefined;
  const name = value.split('@')[0]?.trim().toLowerCase();
  switch (name) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
    case 'deno':
      return name;
    default:
      return undefined;
  }
}
