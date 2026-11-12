import type { CheckResult } from '../core/check.js';
import type { CommandContext, CommandDefinition } from '../core/command.js';
import { redactCredentials } from '../core/redact.js';
import { VERSION } from '../core/version.js';
import { compareSemVer, parseSemVer } from '../parse/semver.js';
import type { SystemAccess } from '../platform/types.js';

/**
 * `git status --porcelain=v2` is a stable, machine-first format, but it only
 * exists from Git 2.11. Rather than mis-parsing older output, the version is
 * established first and the report degrades to a clearly-labelled reduced
 * form. A wrong count presented confidently is worse than an honest gap.
 */
const PORCELAIN_V2_MINIMUM = { major: 2, minor: 11, patch: 0 } as const;

interface GitFacts {
  readonly available: boolean;
  readonly version: string | undefined;
  readonly insideRepository: boolean;
}

async function gitVersion(
  system: SystemAccess,
  cwd: string,
): Promise<GitFacts> {
  const result = await system.exec('git', ['--version'], { cwd });
  if (!result.ran || result.code !== 0) {
    return { available: false, version: undefined, insideRepository: false };
  }

  const match = /(\d+\.\d+\.\d+)/.exec(result.stdout);
  const version = match?.[1];

  const inside = await system.exec(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    { cwd },
  );

  return {
    available: true,
    version,
    insideRepository: inside.ran && inside.code === 0,
  };
}

export async function collectGitChecks(
  system: SystemAccess,
  cwd: string,
): Promise<CheckResult[]> {
  const facts = await gitVersion(system, cwd);

  if (!facts.available) {
    return [
      {
        id: 'git.available',
        title: 'Git',
        status: 'fail',
        summary: 'git is not installed, or is not on PATH',
        detail: { available: false },
        remediation: 'Install Git and ensure it is on PATH.',
      },
    ];
  }

  const results: CheckResult[] = [
    {
      id: 'git.version',
      title: 'Git version',
      status: 'pass',
      summary: `v${facts.version ?? 'unknown'}`,
      detail: { version: facts.version ?? null },
    },
  ];

  if (!facts.insideRepository) {
    results.push({
      id: 'git.repository',
      title: 'Repository',
      status: 'fail',
      summary: 'this directory is not inside a Git working tree',
      detail: { insideRepository: false },
      remediation: "Run this inside a repository, or 'git init' here.",
    });
    return results;
  }

  results.push({
    id: 'git.repository',
    title: 'Repository',
    status: 'pass',
    summary: 'inside a Git working tree',
    detail: { insideRepository: true },
  });

  results.push(await branchCheck(system, cwd));
  results.push(await upstreamCheck(system, cwd));
  results.push(await statusCheck(system, cwd, facts.version));
  results.push(await stashCheck(system, cwd));
  results.push(await lastCommitCheck(system, cwd));
  results.push(...(await remoteChecks(system, cwd)));

  return results;
}

async function branchCheck(
  system: SystemAccess,
  cwd: string,
): Promise<CheckResult> {
  const head = await system.exec('git', ['symbolic-ref', '--quiet', 'HEAD'], {
    cwd,
  });

  if (head.ran && head.code === 0) {
    const branch = head.stdout.trim().replace(/^refs\/heads\//, '');
    return {
      id: 'git.branch',
      title: 'Branch',
      status: 'info',
      summary: branch,
      detail: { branch, detached: false },
    };
  }

  const commit = await system.exec('git', ['rev-parse', '--short', 'HEAD'], {
    cwd,
  });
  const sha = commit.ran && commit.code === 0 ? commit.stdout.trim() : 'unborn';

  return {
    id: 'git.branch',
    title: 'Branch',
    status: 'warn',
    summary:
      sha === 'unborn'
        ? 'no commits yet on this branch'
        : `detached HEAD at ${sha}`,
    detail: { branch: null, detached: sha !== 'unborn', commit: sha },
    remediation:
      sha === 'unborn'
        ? 'Make an initial commit.'
        : 'Check out a branch before committing, or the work will be hard to find later.',
  };
}

async function upstreamCheck(
  system: SystemAccess,
  cwd: string,
): Promise<CheckResult> {
  const upstream = await system.exec(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd },
  );

  if (!upstream.ran || upstream.code !== 0) {
    return {
      id: 'git.upstream',
      title: 'Upstream',
      status: 'info',
      summary: 'no upstream configured for the current branch',
      detail: { upstream: null },
    };
  }

  const name = upstream.stdout.trim();
  const counts = await system.exec(
    'git',
    ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
    { cwd },
  );

  let ahead = 0;
  let behind = 0;
  if (counts.ran && counts.code === 0) {
    const parts = counts.stdout.trim().split(/\s+/);
    ahead = Number(parts[0] ?? 0);
    behind = Number(parts[1] ?? 0);
  }

  const diverged = ahead > 0 && behind > 0;
  return {
    id: 'git.upstream',
    title: 'Upstream',
    status: diverged ? 'warn' : 'info',
    summary: `${name}: ${ahead} ahead, ${behind} behind`,
    detail: { upstream: name, ahead, behind },
    ...(diverged
      ? {
          remediation:
            'The branch and its upstream have both moved; rebase or merge before pushing.',
        }
      : {}),
  };
}

interface StatusCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

/**
 * Parses `--porcelain=v2 -z`. The NUL separator is what makes this correct
 * for filenames containing spaces or newlines, which `-z` is specifically
 * for; the v1 fallback below cannot be made equally safe, and says so.
 */
export function parsePorcelainV2(output: string): StatusCounts {
  const counts: StatusCounts = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  const records = output.split('\u0000').filter((line) => line !== '');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) continue;

    const kind = record.charAt(0);
    if (kind === '?') {
      counts.untracked += 1;
      continue;
    }
    if (kind === 'u') {
      counts.conflicted += 1;
      continue;
    }
    if (kind === '1' || kind === '2') {
      const xy = record.split(' ')[1] ?? '..';
      if (!xy.startsWith('.')) counts.staged += 1;
      if (xy.charAt(1) !== '.') counts.unstaged += 1;
      // A rename record ('2') is followed by its original path as a
      // separate NUL-terminated field, which must not be read as a record.
      if (kind === '2') index += 1;
    }
  }

  return counts;
}

/** Reduced parse for Git older than 2.11, where v2 is unavailable. */
export function parsePorcelainV1(output: string): StatusCounts {
  const counts: StatusCounts = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  for (const record of output.split('\u0000')) {
    if (record === '') continue;
    const x = record.charAt(0);
    const y = record.charAt(1);
    if (x === '?' && y === '?') {
      counts.untracked += 1;
      continue;
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A')) {
      counts.conflicted += 1;
      continue;
    }
    if (x !== ' ' && x !== '') counts.staged += 1;
    if (y !== ' ' && y !== '') counts.unstaged += 1;
  }

  return counts;
}

async function statusCheck(
  system: SystemAccess,
  cwd: string,
  version: string | undefined,
): Promise<CheckResult> {
  const parsedVersion =
    version === undefined ? undefined : parseSemVer(version);
  const supportsV2 =
    parsedVersion !== undefined &&
    compareSemVer(parsedVersion, {
      ...PORCELAIN_V2_MINIMUM,
      prerelease: undefined,
    }) >= 0;

  const args = supportsV2
    ? ['status', '--porcelain=v2', '-z', '--untracked-files=normal']
    : ['status', '--porcelain', '-z', '--untracked-files=normal'];

  const result = await system.exec('git', args, { cwd, timeoutMs: 10_000 });

  if (!result.ran || result.code !== 0) {
    return {
      id: 'git.status',
      title: 'Working tree',
      status: 'warn',
      summary: 'git status could not be read',
      detail: { error: result.error ?? result.stderr.trim() },
      remediation: 'Run `git status` directly to see why.',
    };
  }

  const counts = supportsV2
    ? parsePorcelainV2(result.stdout)
    : parsePorcelainV1(result.stdout);

  const dirty =
    counts.staged + counts.unstaged + counts.untracked + counts.conflicted > 0;

  const degradedNote = supportsV2
    ? ''
    : ' (reduced report: this Git predates --porcelain=v2)';

  return {
    id: 'git.status',
    title: 'Working tree',
    status: counts.conflicted > 0 ? 'fail' : dirty ? 'warn' : 'pass',
    summary: dirty
      ? `${counts.staged} staged, ${counts.unstaged} unstaged, ${counts.untracked} untracked, ${counts.conflicted} conflicted${degradedNote}`
      : `clean${degradedNote}`,
    detail: { ...counts, porcelain: supportsV2 ? 'v2' : 'v1' },
    ...(counts.conflicted > 0
      ? { remediation: 'Resolve the conflicted paths before committing.' }
      : dirty
        ? { remediation: 'Commit or stash before leaving this repository.' }
        : {}),
  };
}

async function stashCheck(
  system: SystemAccess,
  cwd: string,
): Promise<CheckResult> {
  const result = await system.exec('git', ['stash', 'list'], { cwd });
  const count =
    result.ran && result.code === 0
      ? result.stdout.split('\n').filter((line) => line.trim() !== '').length
      : 0;

  return {
    id: 'git.stash',
    title: 'Stash',
    status: count > 0 ? 'info' : 'pass',
    summary: count === 0 ? 'empty' : `${count} stashed change-set(s)`,
    detail: { count },
  };
}

async function lastCommitCheck(
  system: SystemAccess,
  cwd: string,
): Promise<CheckResult> {
  const result = await system.exec(
    'git',
    ['log', '-1', '--no-color', '--pretty=format:%h%x1f%an%x1f%ar%x1f%s'],
    { cwd },
  );

  if (!result.ran || result.code !== 0 || result.stdout.trim() === '') {
    return {
      id: 'git.lastCommit',
      title: 'Last commit',
      status: 'info',
      summary: 'no commits yet',
      detail: { commit: null },
    };
  }

  const [hash, author, when, subject] = result.stdout.split('\u001f');
  return {
    id: 'git.lastCommit',
    title: 'Last commit',
    status: 'info',
    summary: `${hash ?? '?'} ${when ?? ''} — ${subject ?? ''}`.trim(),
    detail: {
      hash: hash ?? null,
      author: author ?? null,
      relativeDate: when ?? null,
      subject: subject ?? null,
    },
  };
}

async function remoteChecks(
  system: SystemAccess,
  cwd: string,
): Promise<CheckResult[]> {
  const result = await system.exec('git', ['remote', '-v'], { cwd });

  if (!result.ran || result.code !== 0 || result.stdout.trim() === '') {
    return [
      {
        id: 'git.remotes',
        title: 'Remotes',
        status: 'info',
        summary: 'none configured',
        detail: { remotes: [] },
      },
    ];
  }

  const seen = new Map<string, string>();
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match === null) continue;
    const [, name, url] = match;
    if (name === undefined || url === undefined) continue;
    // Redaction happens here, at the boundary where the value enters the
    // report, so no downstream renderer has to remember to do it.
    seen.set(name, redactCredentials(url));
  }

  if (seen.size === 0) {
    return [
      {
        id: 'git.remotes',
        title: 'Remotes',
        status: 'info',
        summary: 'none configured',
        detail: { remotes: [] },
      },
    ];
  }

  const remotes = [...seen.entries()].map(([name, url]) => ({ name, url }));
  return [
    {
      id: 'git.remotes',
      title: 'Remotes',
      status: 'info',
      summary: remotes.map(({ name, url }) => `${name} → ${url}`).join('; '),
      detail: { remotes },
    },
  ];
}

export const gitCommand: CommandDefinition = {
  name: 'git',
  summary: 'Git repository diagnostics.',
  usage: 'sablectl git [options]',
  description: [
    'Reports the Git version, whether this directory is inside a working',
    'tree, the branch or detached HEAD, upstream divergence, staged,',
    'unstaged, untracked and conflicted counts, the stash, the last commit,',
    'and the configured remotes with any embedded credentials redacted.',
  ],
  flags: [],
  async run(ctx: CommandContext) {
    const results = await collectGitChecks(ctx.system, ctx.cwd);
    return {
      command: 'git',
      version: VERSION,
      generatedAt: ctx.system.now().toISOString(),
      sections: [{ title: 'Git', results }],
    };
  },
};
