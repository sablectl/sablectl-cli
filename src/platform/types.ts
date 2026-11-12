import type { TerminalCapabilities } from '../core/render/style.js';

/**
 * The single seam between this tool and the outside world.
 *
 * Every operating-system interaction goes through this interface, which is
 * what makes the checks testable: a unit test injects a fake system and
 * asserts on the resulting `CheckResult` values, with no module mocking and
 * no dependence on the machine the tests happen to run on.
 */

export interface ExecResult {
  /** `true` when the executable ran, whatever its exit code. */
  readonly ran: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Populated when the executable could not be run or timed out. */
  readonly error?: string;
  /** `true` when output was truncated at the configured cap. */
  readonly truncated?: boolean;
}

export interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export type ReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: string };

export interface PathStat {
  readonly kind: 'file' | 'directory' | 'symlink' | 'other';
  readonly size: number;
}

export interface OsInfo {
  readonly platform: NodeJS.Platform;
  readonly type: string;
  readonly release: string;
  readonly arch: string;
  readonly cpus: number;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly homedir: string;
  readonly uptimeSeconds: number;
}

export interface DirEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'symlink' | 'other';
}

export interface WalkOptions {
  /** Maximum directory depth below the root. */
  readonly maxDepth: number;
  /** Hard ceiling on entries visited, so traversal always terminates. */
  readonly maxEntries: number;
  /** Directory names skipped entirely, e.g. `node_modules`, `.git`. */
  readonly skipDirectories: readonly string[];
  /** Predicate applied to the root-relative path of each directory. */
  readonly isIgnored?: (relativePath: string) => boolean;
}

export interface WalkEntry {
  /** Path relative to the walk root, using forward slashes. */
  readonly path: string;
  readonly kind: 'file' | 'directory' | 'symlink' | 'other';
  readonly depth: number;
  readonly sizeBytes: number;
}

export interface WalkResult {
  readonly entries: readonly WalkEntry[];
  /** `true` when a bound stopped the traversal before it completed. */
  readonly truncated: boolean;
  /** Symlinks found and deliberately not followed. */
  readonly symlinksSkipped: number;
}

export interface SystemAccess {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion: string;

  now(): Date;
  osInfo(): OsInfo;
  terminal(): TerminalCapabilities;

  /**
   * Runs an executable with an argument array. Implementations must never
   * invoke a shell: no string built from repository data may ever be parsed
   * by one, which makes command injection structurally impossible rather
   * than something to be filtered for.
   */
  exec(
    file: string,
    args: readonly string[],
    options?: ExecOptions,
  ): Promise<ExecResult>;

  /** Reads a UTF-8 file with a size cap. */
  readTextFile(path: string, maxBytes?: number): Promise<ReadResult>;

  /** Stats a path without following the final symlink. */
  statPath(path: string): Promise<PathStat | undefined>;

  readDirectory(path: string): Promise<readonly DirEntry[]>;

  /** Bounded, symlink-safe traversal. */
  walkDirectory(root: string, options: WalkOptions): Promise<WalkResult>;
}
