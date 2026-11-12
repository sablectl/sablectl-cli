import { describe, expect, it } from 'vitest';
import { collectValidateChecks } from '../../../src/commands/validate.js';
import {
  exitCodeFor,
  worstStatus,
  type CheckResult,
  type CheckStatus,
} from '../../../src/core/check.js';
import { EXIT } from '../../../src/core/errors.js';
import { createFakeSystem } from '../../helpers/fake-system.js';

const ROOT = '/project';

function statusOf(results: readonly CheckResult[], id: string): CheckStatus {
  const result = results.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`no check '${id}'`);
  return result.status;
}

function reportOf(results: readonly CheckResult[]) {
  return {
    command: 'validate',
    version: '0.0.0',
    generatedAt: '2024-01-02T03:04:05.000Z',
    sections: [{ title: 'Validation', results }],
  };
}

const CLEAN_MANIFEST = JSON.stringify({
  name: 'demo',
  version: '1.0.0',
  engines: { node: '>=20.19' },
  files: ['dist'],
});

const CLEAN_FILES: Readonly<Record<string, string>> = {
  '/project/package.json': CLEAN_MANIFEST,
  '/project/package-lock.json': '{}',
  '/project/tsconfig.json': '{"compilerOptions":{"strict":true}}',
};

describe('collectValidateChecks', () => {
  it('reports a clean project as all-pass and exit 0', async () => {
    const system = createFakeSystem({ files: CLEAN_FILES });
    const results = await collectValidateChecks(system, ROOT);

    for (const result of results) {
      expect(['pass', 'skip']).toContain(result.status);
    }
    expect(worstStatus(reportOf(results))).toBe('pass');
    expect(exitCodeFor(reportOf(results))).toBe(EXIT.SUCCESS);
    expect(exitCodeFor(reportOf(results), true)).toBe(EXIT.SUCCESS);
  });

  it('fails a dependency declared in both dependency lists', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          engines: { node: '>=20.19' },
          files: ['dist'],
          dependencies: { left: '^1.0.0', shared: '^2.0.0' },
          devDependencies: { shared: '^3.0.0' },
        }),
      },
    });

    const results = await collectValidateChecks(system, ROOT);
    const duplicate = results.find(
      (result) => result.id === 'dependencies.duplicates',
    );

    expect(duplicate?.status).toBe('fail');
    expect(duplicate?.summary).toContain('shared');
    expect(duplicate?.summary).not.toContain('left');
    expect(duplicate?.detail).toEqual({ duplicates: ['shared'] });
    expect(exitCodeFor(reportOf(results))).toBe(EXIT.FAILURE);
  });

  it('passes the duplicate check when each package appears once', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          engines: { node: '>=20.19' },
          files: ['dist'],
          dependencies: { left: '^1.0.0' },
          devDependencies: { right: '^2.0.0' },
        }),
      },
    });

    const results = await collectValidateChecks(system, ROOT);
    expect(statusOf(results, 'dependencies.duplicates')).toBe('pass');
  });

  it('fails when the manifest cannot be read at all', async () => {
    const system = createFakeSystem({ files: {} });
    const results = await collectValidateChecks(system, ROOT);

    expect(results).toHaveLength(1);
    expect(statusOf(results, 'manifest.present')).toBe('fail');
    expect(results[0]?.summary).toContain('package.json could not be read');
  });

  it('fails when the manifest is empty or malformed, naming the path', async () => {
    for (const raw of ['', '{ "name": ']) {
      const system = createFakeSystem({
        files: { '/project/package.json': raw },
      });
      const results = await collectValidateChecks(system, ROOT);

      expect(results).toHaveLength(1);
      expect(statusOf(results, 'manifest.parses')).toBe('fail');
      expect(results[0]?.summary).toContain('package.json');
      expect(results[0]?.detail).toEqual({ path: 'package.json' });
    }
  });

  it('fails when name or version is missing', async () => {
    const system = createFakeSystem({
      files: { ...CLEAN_FILES, '/project/package.json': '{}' },
    });

    const results = await collectValidateChecks(system, ROOT);
    const fields = results.find((result) => result.id === 'manifest.fields');

    expect(fields?.status).toBe('fail');
    expect(fields?.summary).toContain('name');
    expect(fields?.summary).toContain('version');
    expect(statusOf(results, 'manifest.semver')).toBe('skip');
  });

  it('fails a version that is not semantic', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': '{"name":"demo","version":"1.0"}',
      },
    });

    expect(
      statusOf(await collectValidateChecks(system, ROOT), 'manifest.semver'),
    ).toBe('fail');
  });

  it('warns when no lockfile is committed and fails on conflicting ones', async () => {
    const none = createFakeSystem({
      files: { '/project/package.json': CLEAN_MANIFEST },
    });
    expect(
      statusOf(await collectValidateChecks(none, ROOT), 'lockfile.present'),
    ).toBe('warn');

    const conflicting = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/pnpm-lock.yaml': '',
      },
    });
    const results = await collectValidateChecks(conflicting, ROOT);
    const lockfile = results.find((result) => result.id === 'lockfile.present');
    expect(lockfile?.status).toBe('fail');
    expect(lockfile?.summary).toContain('conflicting lockfiles');
  });

  it('fails when packageManager and the committed lockfile disagree', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          packageManager: 'pnpm@9.1.0',
          engines: { node: '>=20.19' },
          files: ['dist'],
        }),
      },
    });

    const results = await collectValidateChecks(system, ROOT);
    const lockfile = results.find((result) => result.id === 'lockfile.present');

    expect(lockfile?.status).toBe('fail');
    expect(lockfile?.summary).toContain('packageManager declares pnpm');
  });

  it('warns when engines.node is absent, unevaluable or unsatisfied', async () => {
    const absent = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': '{"name":"d","version":"1.0.0"}',
      },
    });
    expect(
      statusOf(await collectValidateChecks(absent, ROOT), 'engines.node'),
    ).toBe('warn');

    const unevaluable = createFakeSystem({
      nodeVersion: '22.11.0',
      files: {
        ...CLEAN_FILES,
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          engines: { node: '>=20.x' },
          files: ['dist'],
        }),
      },
    });
    const unevaluableResults = await collectValidateChecks(unevaluable, ROOT);
    const engines = unevaluableResults.find(
      (result) => result.id === 'engines.node',
    );
    expect(engines?.status).toBe('warn');
    expect(engines?.summary).toContain('does not evaluate');

    const unsatisfied = createFakeSystem({
      nodeVersion: '18.20.4',
      files: CLEAN_FILES,
    });
    const unsatisfiedResults = await collectValidateChecks(unsatisfied, ROOT);
    expect(statusOf(unsatisfiedResults, 'engines.node')).toBe('warn');
    expect(exitCodeFor(reportOf(unsatisfiedResults), true)).toBe(EXIT.FAILURE);
  });

  it('judges TypeScript strictness only when a tsconfig is present', async () => {
    const absent = createFakeSystem({
      files: { '/project/package.json': CLEAN_MANIFEST },
    });
    expect(
      statusOf(await collectValidateChecks(absent, ROOT), 'tsconfig.strict'),
    ).toBe('skip');

    const disabled = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/tsconfig.json': '{"compilerOptions":{"strict":false}}',
      },
    });
    expect(
      statusOf(await collectValidateChecks(disabled, ROOT), 'tsconfig.strict'),
    ).toBe('fail');

    const inherited = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/tsconfig.json': '{"extends":"./base.json"}',
      },
    });
    const inheritedResults = await collectValidateChecks(inherited, ROOT);
    const strict = inheritedResults.find(
      (result) => result.id === 'tsconfig.strict',
    );
    expect(strict?.status).toBe('warn');
    expect(strict?.summary).toContain('./base.json');

    const broken = createFakeSystem({
      files: { ...CLEAN_FILES, '/project/tsconfig.json': '{' },
    });
    expect(
      statusOf(await collectValidateChecks(broken, ROOT), 'tsconfig.strict'),
    ).toBe('fail');
  });

  it('fails when a referenced entry point does not exist', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          engines: { node: '>=20.19' },
          files: ['dist'],
          main: './dist/index.js',
          bin: { demo: './dist/bin/demo.js' },
        }),
      },
    });

    const results = await collectValidateChecks(system, ROOT);
    const paths = results.find((result) => result.id === 'manifest.paths');

    expect(paths?.status).toBe('fail');
    expect(paths?.summary).toContain('main → ./dist/index.js (missing)');
    expect(paths?.summary).toContain('bin.demo');
  });

  it('passes when every referenced entry point exists', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          engines: { node: '>=20.19' },
          files: ['dist'],
          main: './dist/index.js',
          exports: { '.': './dist/index.js', './sub/*': './dist/*.js' },
        }),
        '/project/dist/index.js': 'export {};',
      },
    });

    expect(
      statusOf(await collectValidateChecks(system, ROOT), 'manifest.paths'),
    ).toBe('pass');
  });

  it('fails when the files allowlist ships a secret-shaped path', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          engines: { node: '>=20.19' },
          files: ['dist', '.npmrc', 'certs/server.pem'],
        }),
      },
    });

    const results = await collectValidateChecks(system, ROOT);
    const secrets = results.find((result) => result.id === 'publish.secrets');

    expect(secrets?.status).toBe('fail');
    expect(secrets?.summary).toContain('.npmrc');
    expect(secrets?.summary).toContain('certs/server.pem');
  });

  it('warns when there is no files allowlist at all', async () => {
    const system = createFakeSystem({
      files: {
        ...CLEAN_FILES,
        '/project/package.json': '{"name":"demo","version":"1.0.0"}',
      },
    });

    const results = await collectValidateChecks(system, ROOT);
    const secrets = results.find((result) => result.id === 'publish.secrets');

    expect(secrets?.status).toBe('warn');
    expect(secrets?.summary).toContain('.gitignore');
  });

  it('gives every check an id, a title and a summary', async () => {
    const system = createFakeSystem({ files: CLEAN_FILES });
    const results = await collectValidateChecks(system, ROOT);

    const ids = results.map((result) => result.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const result of results) {
      expect(result.title).not.toBe('');
      expect(result.summary).not.toBe('');
      if (result.status === 'fail' || result.status === 'warn') {
        expect(result.remediation).toBeDefined();
      }
    }
  });
});
