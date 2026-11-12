import { describe, expect, it } from 'vitest';
import { collectInspectChecks } from '../../../src/commands/inspect.js';
import type { CheckResult } from '../../../src/core/check.js';
import { createFakeSystem } from '../../helpers/fake-system.js';

const ROOT = '/project';

function find(results: readonly CheckResult[], id: string): CheckResult {
  const result = results.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`no check '${id}'`);
  return result;
}

describe('collectInspectChecks', () => {
  it('describes a conventional TypeScript package', async () => {
    const system = createFakeSystem({
      files: {
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          scripts: { build: 'tsc', test: 'vitest run' },
          dependencies: { left: '^1.0.0' },
          devDependencies: { vitest: '^3.0.0', typescript: '^5.0.0' },
          peerDependencies: { react: '^18.0.0' },
          workspaces: ['packages/*'],
        }),
        '/project/tsconfig.json':
          '{"compilerOptions":{"strict":true,"target":"ES2023"}}',
        '/project/package-lock.json': '{}',
        '/project/src/index.ts': 'export {};',
      },
    });

    const results = await collectInspectChecks(system, ROOT);

    expect(find(results, 'project.type').summary).toBe(
      'Node.js package, TypeScript',
    );
    expect(find(results, 'project.packageManager').summary).toContain('npm');
    expect(find(results, 'project.scripts').summary).toBe('2: build, test');
    expect(find(results, 'project.dependencies').summary).toBe(
      '1 runtime, 2 development, 1 peer',
    );
    expect(find(results, 'project.workspaces').summary).toContain(
      '1 pattern(s): packages/*',
    );
    expect(find(results, 'project.tests').status).toBe('pass');
    expect(find(results, 'project.tests').summary).toBe('Vitest');
    expect(find(results, 'project.typescript').status).toBe('pass');
    expect(find(results, 'project.layout').status).toBe('info');
  });

  it('fails the manifest check when package.json cannot be parsed', async () => {
    const system = createFakeSystem({
      files: { '/project/package.json': '{ oops' },
    });

    const results = await collectInspectChecks(system, ROOT);
    const manifest = find(results, 'project.manifest');

    expect(manifest.status).toBe('fail');
    expect(manifest.summary).toContain('package.json could not be parsed');
    expect(results.some((result) => result.id === 'project.scripts')).toBe(
      false,
    );
  });

  it('warns when the directory holds no recognised manifest', async () => {
    const system = createFakeSystem({ files: { '/project/notes.txt': 'hi' } });
    const results = await collectInspectChecks(system, ROOT);

    const type = find(results, 'project.type');
    expect(type.status).toBe('warn');
    expect(type.summary).toContain('no recognised project manifest');
  });

  it('names every project marker it recognises', async () => {
    const system = createFakeSystem({
      files: {
        '/project/package.json': '{"name":"demo","version":"1.0.0"}',
        '/project/tsconfig.json': '{}',
        '/project/Cargo.toml': '',
        '/project/go.mod': '',
        '/project/pyproject.toml': '',
        '/project/Dockerfile': '',
        '/project/deno.json': '{}',
      },
    });

    const markers = find(
      await collectInspectChecks(system, ROOT),
      'project.type',
    ).summary;

    for (const marker of [
      'Node.js package',
      'TypeScript',
      'Deno',
      'Rust',
      'Go',
      'Python',
      'Docker',
    ]) {
      expect(markers).toContain(marker);
    }
  });

  it('warns when several lockfiles are present', async () => {
    const system = createFakeSystem({
      files: {
        '/project/package.json': '{"name":"demo","version":"1.0.0"}',
        '/project/package-lock.json': '{}',
        '/project/yarn.lock': '',
      },
    });

    const manager = find(
      await collectInspectChecks(system, ROOT),
      'project.packageManager',
    );

    expect(manager.status).toBe('warn');
    expect(manager.summary).toContain('several lockfiles present');
  });

  it('warns when the lockfile disagrees with packageManager', async () => {
    const system = createFakeSystem({
      files: {
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          packageManager: 'yarn@4.1.0',
        }),
        '/project/package-lock.json': '{}',
      },
    });

    const manager = find(
      await collectInspectChecks(system, ROOT),
      'project.packageManager',
    );

    expect(manager.status).toBe('warn');
    expect(manager.summary).toContain('packageManager declares yarn');
  });

  it('infers node:test from the test script when no runner is declared', async () => {
    const system = createFakeSystem({
      files: {
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          scripts: { test: 'node --test' },
        }),
      },
    });

    const tests = find(
      await collectInspectChecks(system, ROOT),
      'project.tests',
    );
    expect(tests.status).toBe('pass');
    expect(tests.summary).toBe('node:test');
  });

  it('warns when a test directory exists but no runner is declared', async () => {
    const system = createFakeSystem({
      files: {
        '/project/package.json': '{"name":"demo","version":"1.0.0"}',
        '/project/tests/a.test.ts': '',
      },
    });

    const tests = find(
      await collectInspectChecks(system, ROOT),
      'project.tests',
    );
    expect(tests.status).toBe('warn');
    expect(tests.summary).toContain('no test framework is declared');
  });

  it('reports symlinks as not followed and a bounded traversal', async () => {
    const system = createFakeSystem({
      files: { '/project/package.json': '{"name":"demo","version":"1.0.0"}' },
      walk: {
        entries: [
          { path: 'src', kind: 'directory', depth: 0, sizeBytes: 0 },
          { path: 'src/index.ts', kind: 'file', depth: 1, sizeBytes: 120 },
          { path: 'loop', kind: 'symlink', depth: 0, sizeBytes: 0 },
        ],
        truncated: true,
        symlinksSkipped: 2,
      },
    });

    const layout = find(
      await collectInspectChecks(system, ROOT),
      'project.layout',
    );

    expect(layout.summary).toContain('1 files in 1 directories');
    expect(layout.summary).toContain('truncated at the traversal bound');
    expect(layout.summary).toContain('2 symlink(s) not followed');
    expect(layout.detail).toMatchObject({
      files: 1,
      directories: 1,
      totalBytes: 120,
      truncated: true,
      symlinksSkipped: 2,
      topLevelDirectories: ['src'],
    });
  });
});
