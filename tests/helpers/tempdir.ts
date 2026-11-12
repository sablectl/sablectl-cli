import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Real temporary fixtures for the integration suite.
 *
 * Every fixture lives under `os.tmpdir()` and is removed afterwards, and
 * every Git invocation carries its own identity and default branch, so no
 * test depends on — or touches — the machine's global configuration or the
 * repository this project lives in.
 */
export async function makeTempDir(prefix = 'sablectl-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function writeFileIn(
  root: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return target;
}

/** Arguments that pin identity and branch naming for a fixture repository. */
export const GIT_CONFIG: readonly string[] = [
  '-c',
  'user.name=Sable Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'init.defaultBranch=main',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];

export interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `git` in a fixture directory with no shell, so a fixture name
 * containing shell metacharacters stays a name.
 */
export async function git(
  cwd: string,
  args: readonly string[],
): Promise<GitRunResult> {
  const { stdout, stderr } = await execFileAsync(
    'git',
    [...GIT_CONFIG, ...args],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
    },
  );
  return { stdout, stderr };
}

/** A repository with one commit on `main`. */
export async function initRepository(root: string): Promise<void> {
  await git(root, ['init', '--quiet']);
  await writeFileIn(root, 'README.md', '# fixture\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '--quiet', '-m', 'Initial commit']);
}

/** True when the text contains something that looks like a stack frame. */
export function hasStackFrame(text: string): boolean {
  return /\n\s+at /.test(text);
}
