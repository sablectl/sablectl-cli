import { lstat, open, readdir } from 'node:fs/promises';
import {
  arch,
  cpus,
  freemem,
  homedir,
  platform,
  release,
  totalmem,
  type as osType,
  uptime,
} from 'node:os';
import type { TerminalCapabilities } from '../core/render/style.js';
import { walk } from './fswalk.js';
import { runCommand } from './process.js';
import type {
  DirEntry,
  ExecOptions,
  ExecResult,
  OsInfo,
  PathStat,
  ReadResult,
  SystemAccess,
  WalkOptions,
  WalkResult,
} from './types.js';

/**
 * Every file read is capped. A manifest is a few kilobytes; anything far
 * larger is either a mistake or an attempt to exhaust memory, and in both
 * cases refusing with a clear reason beats reading it.
 */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export class NodeSystem implements SystemAccess {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.env = process.env;
    this.nodeVersion = process.versions.node;
  }

  now(): Date {
    return new Date();
  }

  osInfo(): OsInfo {
    return {
      platform: platform(),
      type: osType(),
      release: release(),
      arch: arch(),
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      homedir: homedir(),
      uptimeSeconds: Math.trunc(uptime()),
    };
  }

  terminal(): TerminalCapabilities {
    return {
      isTTY: process.stdout.isTTY ?? false,
      columns: process.stdout.columns,
      env: process.env,
    };
  }

  async exec(
    file: string,
    args: readonly string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    return runCommand(file, args, { cwd: this.cwd, ...options });
  }

  /**
   * Reads at most `maxBytes`. The size is checked through the open file
   * handle rather than by a separate `stat`, so the file cannot be swapped
   * for a larger one between the check and the read.
   */
  async readTextFile(
    path: string,
    maxBytes: number = DEFAULT_MAX_FILE_BYTES,
  ): Promise<ReadResult> {
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (error: unknown) {
      return { ok: false, reason: describeError(error) };
    }

    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        return { ok: false, reason: 'not a regular file' };
      }
      if (stats.size > maxBytes) {
        return {
          ok: false,
          reason: `file is ${String(stats.size)} bytes, over the ${String(maxBytes)}-byte limit`,
        };
      }
      const buffer = Buffer.alloc(stats.size);
      await handle.read(buffer, 0, buffer.length, 0);
      return { ok: true, content: buffer.toString('utf8') };
    } catch (error: unknown) {
      return { ok: false, reason: describeError(error) };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async statPath(path: string): Promise<PathStat | undefined> {
    try {
      const stats = await lstat(path);
      const kind = stats.isSymbolicLink()
        ? 'symlink'
        : stats.isDirectory()
          ? 'directory'
          : stats.isFile()
            ? 'file'
            : 'other';
      return { kind, size: stats.size };
    } catch {
      return undefined;
    }
  }

  async readDirectory(path: string): Promise<readonly DirEntry[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? 'symlink'
          : entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : 'other',
      }));
    } catch {
      return [];
    }
  }

  async walkDirectory(root: string, options: WalkOptions): Promise<WalkResult> {
    return walk(root, options);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error ? String(error.code) : undefined;
    return code ?? error.message;
  }
  return 'unknown error';
}
