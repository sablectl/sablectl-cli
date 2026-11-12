import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { EXIT } from '../../src/core/errors.js';
import { NodeSystem } from '../../src/platform/system.js';
import { captureIo } from '../helpers/fake-system.js';
import { parseEnvelope, statusesById } from '../helpers/json.js';
import {
  git,
  hasStackFrame,
  initRepository,
  makeTempDir,
  removeTempDir,
  writeFileIn,
} from '../helpers/tempdir.js';

// Assembled at runtime so no credential-shaped literal exists in the
// repository: the pre-push gate and secret scanners cannot tell a test
// fixture from a real leak, and they should not have to.
const TOKEN = ['ghp', 'EXAMPLETOKEN1234567890'].join('_');

let root: string;

beforeEach(async () => {
  root = await makeTempDir('sablectl-git-');
});

afterEach(async () => {
  await removeTempDir(root);
});

async function runGit(argv: readonly string[]) {
  const io = captureIo();
  const code = await run(argv, io, new NodeSystem(root));
  return { code, out: io.out(), err: io.err() };
}

describe('git command against real repositories', () => {
  it('reports the branch, the counts and the remote of a real repository', async () => {
    await initRepository(root);
    await writeFileIn(root, 'staged.txt', 'staged\n');
    await git(root, ['add', 'staged.txt']);
    await writeFileIn(root, 'untracked.txt', 'untracked\n');
    await git(root, [
      'remote',
      'add',
      'origin',
      'https://github.com/example/fixture.git',
    ]);

    const { code, out } = await runGit(['git', '--json']);
    const envelope = parseEnvelope(out);
    const statuses = statusesById(envelope);

    expect(code).toBe(EXIT.SUCCESS);
    expect(statuses.get('git.repository')).toBe('pass');
    expect(out).toContain('"branch": "main"');
    expect(out).toContain('"staged": 1');
    expect(out).toContain('"untracked": 1');
    expect(out).toContain('https://github.com/example/fixture.git');
    expect(statuses.get('git.status')).toBe('warn');
  });

  it('never prints a credential embedded in a remote, in either format', async () => {
    await initRepository(root);
    await git(root, [
      'remote',
      'add',
      'origin',
      `https://sable:${TOKEN}@github.com/x/y.git`,
    ]);

    const human = await runGit(['git']);
    const json = await runGit(['git', '--json']);
    const doctor = await runGit(['doctor']);

    for (const result of [human, json, doctor]) {
      expect(result.out).not.toContain(TOKEN);
      expect(result.err).not.toContain(TOKEN);
      expect(result.out).not.toContain('ghp_');
    }
    expect(human.out).toContain('***');
    expect(json.out).toContain('***');
  });

  it('reports a detached HEAD without crashing', async () => {
    await initRepository(root);
    const { stdout } = await git(root, ['rev-parse', 'HEAD']);
    await git(root, ['checkout', '--quiet', '--detach', stdout.trim()]);

    const { code, out, err } = await runGit(['git']);

    expect(out).toContain('detached HEAD at');
    expect(code).toBe(EXIT.SUCCESS);
    expect(hasStackFrame(out)).toBe(false);
    expect(hasStackFrame(err)).toBe(false);
  });

  it('reports a directory that is not a repository and exits 1', async () => {
    const { code, out, err } = await runGit(['git']);

    expect(code).toBe(EXIT.FAILURE);
    expect(out).toContain('not inside a Git working tree');
    expect(out).toContain('FAIL');
    expect(hasStackFrame(out)).toBe(false);
    expect(hasStackFrame(err)).toBe(false);
  });

  it('treats a branch name full of shell metacharacters literally', async () => {
    await initRepository(root);
    const hostile = 'feature/;$(id)-`id`-&&-whoami';
    await git(root, ['checkout', '--quiet', '-b', hostile]);

    const { code, out } = await runGit(['git', '--json']);

    expect(code).toBe(EXIT.SUCCESS);
    expect(out).toContain('$(id)');
    expect(out).not.toMatch(/uid=\d+/);
    expect(out).not.toContain('gid=');
  });

  it('treats a directory name full of shell metacharacters literally', async () => {
    const hostile = await makeTempDir('sablectl-git-;$(id)-');
    try {
      await initRepository(hostile);
      const io = captureIo();
      const code = await run(['git'], io, new NodeSystem(hostile));

      expect(code).toBe(EXIT.SUCCESS);
      expect(io.out()).not.toMatch(/uid=\d+/);
      expect(hasStackFrame(io.err())).toBe(false);
    } finally {
      await removeTempDir(hostile);
    }
  });

  it('reports an unborn branch in a freshly initialised repository', async () => {
    await git(root, ['init', '--quiet']);

    const { code, out } = await runGit(['git']);

    // `git symbolic-ref HEAD` still answers before the first commit, so the
    // branch is reported normally and the absence of history shows up as the
    // last-commit check rather than as a crash.
    expect(code).toBe(EXIT.SUCCESS);
    expect(out).toContain('no commits yet');
    expect(out).toContain('Last commit');
  });
});
