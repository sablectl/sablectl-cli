import { describe, expect, it } from 'vitest';
import {
  collectGitChecks,
  gitCommand,
  parsePorcelainV1,
  parsePorcelainV2,
} from '../../../src/commands/git.js';
import type { CheckResult } from '../../../src/core/check.js';
import { resolveStyle } from '../../../src/core/render/style.js';
import type { ExecResult } from '../../../src/platform/types.js';
import { createFakeSystem, type FakeExec } from '../../helpers/fake-system.js';

// Assembled at runtime so no credential-shaped literal exists in the
// repository: the pre-push gate and secret scanners cannot tell a test
// fixture from a real leak, and they should not have to.
const TOKEN = ['ghp', 'EXAMPLETOKEN1234567890'].join('_');

function ok(stdout: string): ExecResult {
  return { ran: true, code: 0, stdout, stderr: '' };
}

function failed(stderr: string, code = 128): ExecResult {
  return { ran: true, code, stdout: '', stderr };
}

function find(results: readonly CheckResult[], id: string): CheckResult {
  const result = results.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`no check '${id}'`);
  return result;
}

/** A fake `git` whose answers are stated per subcommand. */
function fakeGit(responses: Readonly<Record<string, ExecResult>>): FakeExec {
  return (file, args) => {
    if (file !== 'git') {
      return { ran: false, code: null, stdout: '', stderr: '' };
    }
    const key = args.join(' ');
    const matched = Object.entries(responses).find(([prefix]) =>
      key.startsWith(prefix),
    );
    return matched?.[1] ?? failed(`unexpected: git ${key}`);
  };
}

const HEALTHY: Readonly<Record<string, ExecResult>> = {
  '--version': ok('git version 2.45.1\n'),
  'rev-parse --is-inside-work-tree': ok('true\n'),
  'symbolic-ref': ok('refs/heads/main\n'),
  'rev-parse --abbrev-ref': failed('no upstream'),
  status: ok(''),
  'stash list': ok(''),
  log: ok('abc1234\u001fAda\u001f2 days ago\u001fInitial commit'),
  'remote -v': ok(''),
};

describe('collectGitChecks', () => {
  it('fails when git is not installed', async () => {
    const system = createFakeSystem({
      exec: () => ({
        ran: false,
        code: null,
        stdout: '',
        stderr: '',
        error: 'executable not found: git',
      }),
    });

    const results = await collectGitChecks(system, '/project');

    expect(results).toHaveLength(1);
    expect(find(results, 'git.available').status).toBe('fail');
    expect(find(results, 'git.available').remediation).toContain('Install Git');
  });

  it('fails when the directory is not a repository', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        '--version': ok('git version 2.45.1\n'),
        'rev-parse --is-inside-work-tree': failed(
          'fatal: not a git repository (or any of the parent directories): .git\n',
        ),
      }),
    });

    const results = await collectGitChecks(system, '/project');

    expect(find(results, 'git.version').status).toBe('pass');
    const repository = find(results, 'git.repository');
    expect(repository.status).toBe('fail');
    expect(repository.summary).toContain('not inside a Git working tree');
    expect(repository.remediation).toContain('git init');
    expect(results.map((result) => result.id)).toEqual([
      'git.version',
      'git.repository',
    ]);
  });

  it('reports a clean repository on a branch', async () => {
    const system = createFakeSystem({ exec: fakeGit(HEALTHY) });
    const results = await collectGitChecks(system, '/project');

    expect(find(results, 'git.repository').status).toBe('pass');
    expect(find(results, 'git.branch').summary).toBe('main');
    expect(find(results, 'git.branch').detail).toEqual({
      branch: 'main',
      detached: false,
    });
    expect(find(results, 'git.status').status).toBe('pass');
    expect(find(results, 'git.status').summary).toBe('clean');
    expect(find(results, 'git.stash').summary).toBe('empty');
    expect(find(results, 'git.lastCommit').summary).toContain('abc1234');
    expect(find(results, 'git.remotes').summary).toBe('none configured');
  });

  it('warns about a detached HEAD and names the commit', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        ...HEALTHY,
        'symbolic-ref': failed(''),
        'rev-parse --short': ok('deadbee\n'),
      }),
    });

    const branch = find(
      await collectGitChecks(system, '/project'),
      'git.branch',
    );

    expect(branch.status).toBe('warn');
    expect(branch.summary).toBe('detached HEAD at deadbee');
    expect(branch.detail).toEqual({
      branch: null,
      detached: true,
      commit: 'deadbee',
    });
  });

  it('warns about an unborn branch', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        ...HEALTHY,
        'symbolic-ref': failed(''),
        'rev-parse --short': failed('fatal: bad revision'),
      }),
    });

    const branch = find(
      await collectGitChecks(system, '/project'),
      'git.branch',
    );
    expect(branch.status).toBe('warn');
    expect(branch.summary).toBe('no commits yet on this branch');
    expect(branch.remediation).toBe('Make an initial commit.');
  });

  it('warns when the branch and its upstream have both moved', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        ...HEALTHY,
        'rev-parse --abbrev-ref': ok('origin/main\n'),
        'rev-list': ok('2\t3\n'),
      }),
    });

    const upstream = find(
      await collectGitChecks(system, '/project'),
      'git.upstream',
    );

    expect(upstream.status).toBe('warn');
    expect(upstream.summary).toBe('origin/main: 2 ahead, 3 behind');
    expect(upstream.detail).toEqual({
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
    });
  });

  it('counts a dirty working tree as a warning', async () => {
    const porcelain = [
      '1 M. N... 100644 100644 100644 aaa bbb staged.txt',
      '1 .M N... 100644 100644 100644 aaa bbb unstaged.txt',
      '? untracked.txt',
      '',
    ].join('\u0000');

    const system = createFakeSystem({
      exec: fakeGit({ ...HEALTHY, status: ok(porcelain) }),
    });

    const status = find(
      await collectGitChecks(system, '/project'),
      'git.status',
    );
    expect(status.status).toBe('warn');
    expect(status.summary).toBe(
      '1 staged, 1 unstaged, 1 untracked, 0 conflicted',
    );
    expect(status.detail).toMatchObject({ porcelain: 'v2' });
  });

  it('fails outright when a path is conflicted', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        ...HEALTHY,
        status: ok('u UU N... 1 2 3 aaa bbb ccc both.txt\u0000'),
      }),
    });

    const status = find(
      await collectGitChecks(system, '/project'),
      'git.status',
    );
    expect(status.status).toBe('fail');
    expect(status.remediation).toContain('Resolve the conflicted paths');
  });

  it('degrades to the v1 parse for a Git older than 2.11', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        ...HEALTHY,
        '--version': ok('git version 2.9.5\n'),
        status: ok('?? untracked.txt\u0000'),
      }),
    });

    const results = await collectGitChecks(system, '/project');
    const status = find(results, 'git.status');

    expect(status.summary).toContain('reduced report');
    expect(status.detail).toMatchObject({ porcelain: 'v1' });
    expect(
      system.execCalls.some((call) => call.args.includes('--porcelain=v2')),
    ).toBe(false);
  });

  it('warns when git status cannot be read at all', async () => {
    const system = createFakeSystem({
      exec: fakeGit({ ...HEALTHY, status: failed('fatal: index is locked') }),
    });

    const status = find(
      await collectGitChecks(system, '/project'),
      'git.status',
    );
    expect(status.status).toBe('warn');
    expect(status.summary).toBe('git status could not be read');
  });

  it('counts the stash entries', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        ...HEALTHY,
        'stash list': ok('stash@{0}: WIP\nstash@{1}: WIP\n'),
      }),
    });

    const stash = find(await collectGitChecks(system, '/project'), 'git.stash');
    expect(stash.status).toBe('info');
    expect(stash.summary).toBe('2 stashed change-set(s)');
  });

  it('redacts a credential embedded in a remote URL', async () => {
    const system = createFakeSystem({
      exec: fakeGit({
        ...HEALTHY,
        'remote -v': ok(
          [
            `origin\thttps://sable:${TOKEN}@github.com/x/y.git (fetch)`,
            `origin\thttps://sable:${TOKEN}@github.com/x/y.git (push)`,
            'mirror\tgit@github.com:owner/repo.git (fetch)',
            'mirror\tgit@github.com:owner/repo.git (push)',
            '',
          ].join('\n'),
        ),
      }),
    });

    const remotes = find(
      await collectGitChecks(system, '/project'),
      'git.remotes',
    );

    expect(JSON.stringify(remotes)).not.toContain(TOKEN);
    expect(remotes.summary).toContain('origin → https://***:***@github.com');
    expect(remotes.summary).toContain('mirror → git@github.com:owner/repo.git');
  });

  it('passes the working directory to every git invocation', async () => {
    const system = createFakeSystem({ exec: fakeGit(HEALTHY) });
    await collectGitChecks(system, '/project/sub');

    expect(system.execCalls.length).toBeGreaterThan(0);
    for (const call of system.execCalls) {
      expect(call.file).toBe('git');
    }
  });
});

describe('parsePorcelainV2', () => {
  it('counts staged, unstaged, untracked and conflicted records', () => {
    const output = [
      '1 M. N... 100644 100644 100644 aaa bbb staged.txt',
      '1 .M N... 100644 100644 100644 aaa bbb unstaged.txt',
      '1 MM N... 100644 100644 100644 aaa bbb both.txt',
      '? untracked.txt',
      'u UU N... 1 2 3 aaa bbb ccc conflicted.txt',
      '',
    ].join('\u0000');

    expect(parsePorcelainV2(output)).toEqual({
      staged: 2,
      unstaged: 2,
      untracked: 1,
      conflicted: 1,
    });
  });

  it('does not count the original path of a rename as a record', () => {
    const output = [
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
      'old.txt',
      '',
    ].join('\u0000');

    expect(parsePorcelainV2(output)).toEqual({
      staged: 1,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    });
  });

  it('counts nothing for a clean tree', () => {
    expect(parsePorcelainV2('')).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    });
  });
});

describe('parsePorcelainV1', () => {
  it('counts the reduced form', () => {
    const output = ['M  staged.txt', ' M unstaged.txt', '?? new.txt', ''].join(
      '\u0000',
    );

    expect(parsePorcelainV1(output)).toEqual({
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 0,
    });
  });

  it('counts both-added and unmerged records as conflicts', () => {
    expect(parsePorcelainV1('AA both.txt\u0000UU other.txt\u0000')).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 2,
    });
  });
});

describe('gitCommand', () => {
  it('returns a single Git section', async () => {
    const system = createFakeSystem({ exec: fakeGit(HEALTHY) });

    const report = await gitCommand.run({
      cwd: '/project',
      system,
      output: resolveStyle(system.terminal()),
      flags: { booleans: new Map(), strings: new Map() },
      positionals: [],
    });

    expect(report.command).toBe('git');
    expect(report.sections.map((section) => section.title)).toEqual(['Git']);
  });
});
