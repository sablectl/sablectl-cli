import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import type { TerminalCapabilities } from '../../src/core/render/style.js';
import type {
  DirEntry,
  ExecOptions,
  ExecResult,
  OsInfo,
  PathStat,
  ReadResult,
  SystemAccess,
  WalkResult,
} from '../../src/platform/types.js';

/**
 * An in-memory `SystemAccess`.
 *
 * Unit tests inject this rather than mocking modules, so a check is
 * exercised against data the test states explicitly and the result cannot
 * depend on the machine the suite happens to run on.
 */
export type FakeExec = (
  file: string,
  args: readonly string[],
  options: ExecOptions | undefined,
) => ExecResult | Promise<ExecResult>;

export interface FakeSystemOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion?: string;
  readonly now?: Date;
  readonly os?: Partial<OsInfo>;
  readonly terminal?: Partial<TerminalCapabilities>;
  /** File contents keyed by absolute path. */
  readonly files?: Readonly<Record<string, string>>;
  /** Extra directories that contain no files of their own. */
  readonly directories?: readonly string[];
  /** Paths that exist as symlinks, for `statPath`. */
  readonly symlinks?: readonly string[];
  readonly exec?: FakeExec;
  readonly walk?: WalkResult;
}

const DEFAULT_OS: OsInfo = {
  platform: 'linux',
  type: 'Linux',
  release: '6.1.0-test',
  arch: 'x64',
  cpus: 8,
  totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  freeMemoryBytes: 4 * 1024 * 1024 * 1024,
  homedir: '/home/tester',
  uptimeSeconds: 3600,
};

const DEFAULT_CWD = '/project';

function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

function normalise(path: string, cwd: string): string {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  return posix.normalize(absolute);
}

export class FakeSystem implements SystemAccess {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion: string;

  /** Every `exec` call, in order, for tests that assert on arguments. */
  readonly execCalls: { file: string; args: readonly string[] }[] = [];

  private readonly files: Map<string, string>;
  private readonly directories: Set<string>;
  private readonly symlinks: Set<string>;
  private readonly clock: Date;
  private readonly os: OsInfo;
  private readonly caps: TerminalCapabilities;
  private readonly execImpl: FakeExec | undefined;
  private readonly walkResult: WalkResult | undefined;

  constructor(options: FakeSystemOptions = {}) {
    this.cwd = options.cwd ?? DEFAULT_CWD;
    this.env = options.env ?? {};
    this.nodeVersion = options.nodeVersion ?? '22.11.0';
    this.clock = options.now ?? new Date('2024-01-02T03:04:05.000Z');
    this.os = { ...DEFAULT_OS, ...options.os };
    this.caps = {
      isTTY: options.terminal?.isTTY ?? false,
      columns: options.terminal?.columns ?? 80,
      env: options.terminal?.env ?? this.env,
    };
    this.execImpl = options.exec;
    this.walkResult = options.walk;

    this.files = new Map(
      Object.entries(options.files ?? {}).map(([path, content]) => [
        normalise(path, this.cwd),
        content,
      ]),
    );
    this.symlinks = new Set(
      (options.symlinks ?? []).map((path) => normalise(path, this.cwd)),
    );

    this.directories = new Set<string>();
    for (const path of options.directories ?? []) {
      this.addDirectoryChain(normalise(path, this.cwd));
    }
    for (const path of this.files.keys()) {
      this.addDirectoryChain(dirname(path));
    }
    this.addDirectoryChain(this.cwd);
  }

  private addDirectoryChain(path: string): void {
    let current = path;
    for (;;) {
      this.directories.add(current);
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }

  now(): Date {
    return this.clock;
  }

  osInfo(): OsInfo {
    return this.os;
  }

  terminal(): TerminalCapabilities {
    return this.caps;
  }

  async exec(
    file: string,
    args: readonly string[],
    options?: ExecOptions,
  ): Promise<ExecResult> {
    this.execCalls.push({ file, args: [...args] });
    if (this.execImpl === undefined) {
      return {
        ran: false,
        code: null,
        stdout: '',
        stderr: '',
        error: `executable not found: ${file}`,
      };
    }
    return this.execImpl(file, args, options);
  }

  readTextFile(path: string, maxBytes = 1024 * 1024): Promise<ReadResult> {
    const key = normalise(path, this.cwd);
    const content = this.files.get(key);
    if (content === undefined) {
      return Promise.resolve({
        ok: false,
        reason: this.directories.has(key) ? 'not a regular file' : 'ENOENT',
      });
    }
    const size = byteLength(content);
    if (size > maxBytes) {
      return Promise.resolve({
        ok: false,
        reason: `file is ${String(size)} bytes, over the ${String(maxBytes)}-byte limit`,
      });
    }
    return Promise.resolve({ ok: true, content });
  }

  async statPath(path: string): Promise<PathStat | undefined> {
    const key = normalise(path, this.cwd);
    if (this.symlinks.has(key)) {
      return Promise.resolve({ kind: 'symlink', size: 0 });
    }
    const content = this.files.get(key);
    if (content !== undefined) {
      return Promise.resolve({ kind: 'file', size: byteLength(content) });
    }
    if (this.directories.has(key)) {
      return Promise.resolve({ kind: 'directory', size: 0 });
    }
    return Promise.resolve(undefined);
  }

  readDirectory(path: string): Promise<readonly DirEntry[]> {
    const key = normalise(path, this.cwd);
    if (!this.directories.has(key)) return Promise.resolve([]);

    const entries = new Map<string, DirEntry>();
    const prefix = key === '/' ? '/' : `${key}/`;

    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const name = rest.split('/')[0];
      if (name === undefined || name === '') continue;
      entries.set(name, {
        name,
        kind: rest.includes('/')
          ? 'directory'
          : this.symlinks.has(file)
            ? 'symlink'
            : 'file',
      });
    }

    for (const directory of this.directories) {
      if (!directory.startsWith(prefix)) continue;
      const rest = directory.slice(prefix.length);
      const name = rest.split('/')[0];
      if (name === undefined || name === '') continue;
      entries.set(name, { name, kind: 'directory' });
    }

    return Promise.resolve(
      [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  // `SystemAccess.walkDirectory` also takes walk options; the fake ignores
  // them and a narrower signature still satisfies the interface, so the
  // unused parameter is omitted rather than named and discarded.
  walkDirectory(root: string): Promise<WalkResult> {
    if (this.walkResult !== undefined) return Promise.resolve(this.walkResult);

    const key = normalise(root, this.cwd);
    const prefix = key === '/' ? '/' : `${key}/`;
    const entries = [...this.files.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, content]) => ({
        path: path.slice(prefix.length),
        kind: 'file' as const,
        depth: path.slice(prefix.length).split('/').length - 1,
        sizeBytes: byteLength(content),
      }));

    return Promise.resolve({ entries, truncated: false, symlinksSkipped: 0 });
  }
}

export function createFakeSystem(options: FakeSystemOptions = {}): FakeSystem {
  return new FakeSystem(options);
}

/** Collects the two output streams `run` writes to. */
export interface CapturedIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  out(): string;
  err(): string;
}

export function captureIo(): CapturedIo {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    stdout: (text: string) => outChunks.push(text),
    stderr: (text: string) => errChunks.push(text),
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

/** A path join that keeps the fake file map readable in the test body. */
export function at(root: string, ...parts: string[]): string {
  return join(root, ...parts);
}
