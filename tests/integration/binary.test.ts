import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/core/errors.js';
import { isRecord, parseEnvelope, stringAt } from '../helpers/json.js';
import {
  hasStackFrame,
  initRepository,
  makeTempDir,
  removeTempDir,
  writeFileIn,
} from '../helpers/tempdir.js';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BINARY = join(PROJECT_ROOT, 'dist', 'bin', 'sablectl.js');

interface SpawnResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the compiled entry point as a real child process. */
async function sablectl(
  args: readonly string[],
  cwd: string,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    execFile(
      process.execPath,
      [BINARY, ...args],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', LC_ALL: 'C' },
        timeout: 20_000,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout, stderr });
          return;
        }
        reject(new Error(`sablectl could not be spawned: ${error.message}`));
      },
    );
  });
}

async function build(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'npm',
      ['run', '--silent', 'build'],
      { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120_000 },
      (error) => {
        if (error === null) resolve();
        else reject(new Error(`build failed: ${error.message}`));
      },
    );
  });
}

async function manifestVersion(): Promise<string> {
  const raw = await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || typeof parsed['version'] !== 'string') {
    throw new Error('package.json has no string version');
  }
  return parsed['version'];
}

let fixture: string;

beforeAll(async () => {
  // Build first, so these tests exercise the entry point a user installs
  // rather than whatever happened to be left in `dist/`.
  await build();
  await access(BINARY);
  fixture = await makeTempDir('sablectl-binary-');
}, 150_000);

afterAll(async () => {
  await removeTempDir(fixture);
});

describe('the compiled binary', () => {
  it('prints the manifest version and exits 0', async () => {
    const result = await sablectl(['--version'], fixture);

    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.stdout).toBe(`sablectl v${await manifestVersion()}\n`);
    expect(result.stderr).toBe('');
  });

  it('prints help and exits 0 with no arguments', async () => {
    const result = await sablectl([], fixture);

    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.stdout).toContain('Usage: sablectl <command> [options]');
  });

  it('exits 2 for an unknown command, writing to stderr only', async () => {
    const result = await sablectl(['nope'], fixture);

    expect(result.code).toBe(EXIT.USAGE);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown command 'nope'");
    expect(hasStackFrame(result.stderr)).toBe(false);
  });

  it('exits 2 for a --path that escapes the working directory', async () => {
    const result = await sablectl(['inspect', '--path', '../../etc'], fixture);

    expect(result.code).toBe(EXIT.USAGE);
    expect(result.stderr).toContain('must stay within the working directory');
  });

  it('exits 1 outside a repository and prints no stack trace', async () => {
    const result = await sablectl(['git'], fixture);

    expect(result.code).toBe(EXIT.FAILURE);
    expect(result.stdout).toContain('not inside a Git working tree');
    expect(hasStackFrame(result.stdout)).toBe(false);
    expect(hasStackFrame(result.stderr)).toBe(false);
  });

  it('exits 0 and emits a parseable envelope inside a real repository', async () => {
    const repository = await makeTempDir('sablectl-binary-repo-');
    try {
      await initRepository(repository);
      await writeFileIn(
        repository,
        'package.json',
        JSON.stringify({
          name: 'fixture',
          version: '1.0.0',
          engines: { node: '>=20.19' },
          files: ['dist'],
        }),
      );
      await writeFileIn(repository, 'package-lock.json', '{}');

      const result = await sablectl(['git', '--json'], repository);
      const envelope = parseEnvelope(result.stdout);

      expect(result.code).toBe(EXIT.SUCCESS);
      expect(stringAt(envelope, 'command')).toBe('git');
      expect(stringAt(envelope, 'tool')).toBe('sablectl');
      expect(result.stdout).not.toContain('\u001B');
    } finally {
      await removeTempDir(repository);
    }
  });

  it('exits 1 for a project whose checks fail', async () => {
    const broken = await makeTempDir('sablectl-binary-broken-');
    try {
      await writeFileIn(broken, 'package.json', '{ oops');
      const result = await sablectl(['validate'], broken);

      expect(result.code).toBe(EXIT.FAILURE);
      expect(result.stdout).toContain('FAIL');
    } finally {
      await removeTempDir(broken);
    }
  });
});
