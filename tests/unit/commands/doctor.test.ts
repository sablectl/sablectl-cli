import { describe, expect, it } from 'vitest';
import { doctorCommand } from '../../../src/commands/doctor.js';
import { compareSeverity } from '../../../src/core/check.js';
import { UsageError } from '../../../src/core/errors.js';
import { resolveStyle } from '../../../src/core/render/style.js';
import type { ExecResult } from '../../../src/platform/types.js';
import {
  createFakeSystem,
  type FakeSystem,
} from '../../helpers/fake-system.js';

const ROOT = '/project';

function fakeGit(file: string, args: readonly string[]): ExecResult {
  if (file !== 'git') {
    return { ran: false, code: null, stdout: '', stderr: '' };
  }
  const key = args.join(' ');
  if (key.startsWith('--version')) {
    return { ran: true, code: 0, stdout: 'git version 2.45.1\n', stderr: '' };
  }
  if (key.startsWith('rev-parse --is-inside-work-tree')) {
    return { ran: true, code: 0, stdout: 'true\n', stderr: '' };
  }
  if (key.startsWith('symbolic-ref')) {
    return { ran: true, code: 0, stdout: 'refs/heads/main\n', stderr: '' };
  }
  return { ran: true, code: 1, stdout: '', stderr: '' };
}

function system(): FakeSystem {
  return createFakeSystem({
    nodeVersion: '22.11.0',
    exec: fakeGit,
    files: {
      '/project/package.json': JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        engines: { node: '>=20.19' },
        files: ['dist'],
      }),
      '/project/package-lock.json': '{}',
      '/project/tsconfig.json': '{"compilerOptions":{"strict":true}}',
    },
  });
}

function context(fake: FakeSystem, path?: string) {
  return {
    cwd: ROOT,
    system: fake,
    output: resolveStyle(fake.terminal()),
    flags: {
      booleans: new Map<string, boolean>(),
      strings:
        path === undefined
          ? new Map<string, string>()
          : new Map<string, string>([['path', path]]),
    },
    positionals: [],
  };
}

describe('doctorCommand', () => {
  it('reports sections from all four check registries', async () => {
    const report = await doctorCommand.run(context(system()));

    expect(report.command).toBe('doctor');
    expect(report.sections.map((section) => section.title)).toEqual([
      'Environment',
      'Git',
      'Project',
      'Validation',
    ]);
    for (const section of report.sections) {
      expect(section.results.length).toBeGreaterThan(0);
    }
  });

  it('carries the identifying checks of each underlying command', async () => {
    const report = await doctorCommand.run(context(system()));
    const ids = report.sections.flatMap((section) =>
      section.results.map((result) => result.id),
    );

    for (const id of [
      'node.version',
      'git.repository',
      'project.type',
      'manifest.parses',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('orders the results of every section worst-first', async () => {
    const report = await doctorCommand.run(context(system()));

    for (const section of report.sections) {
      const statuses = section.results.map((result) => result.status);
      for (let index = 1; index < statuses.length; index += 1) {
        const previous = statuses[index - 1];
        const current = statuses[index];
        if (previous === undefined || current === undefined) continue;
        expect(compareSeverity(previous, current)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('owns no checks of its own beyond the four registries', async () => {
    const report = await doctorCommand.run(context(system()));
    const ids = report.sections.flatMap((section) =>
      section.results.map((result) => result.id),
    );

    expect(ids.some((id) => id.startsWith('doctor.'))).toBe(false);
  });

  it('refuses a --path that escapes the working directory', async () => {
    await expect(
      doctorCommand.run(context(system(), '../../etc')),
    ).rejects.toBeInstanceOf(UsageError);
  });
});
