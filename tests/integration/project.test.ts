import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { EXIT } from '../../src/core/errors.js';
import { NodeSystem } from '../../src/platform/system.js';
import { captureIo } from '../helpers/fake-system.js';
import { parseEnvelope, statusesById } from '../helpers/json.js';
import {
  hasStackFrame,
  makeTempDir,
  removeTempDir,
  writeFileIn,
} from '../helpers/tempdir.js';

let root: string;
const rejections: unknown[] = [];

function recordRejection(reason: unknown): void {
  rejections.push(reason);
}

beforeEach(async () => {
  root = await makeTempDir('sablectl-project-');
  rejections.length = 0;
  process.on('unhandledRejection', recordRejection);
});

afterEach(async () => {
  process.off('unhandledRejection', recordRejection);
  expect(rejections).toEqual([]);
  await removeTempDir(root);
});

async function runIn(argv: readonly string[], cwd = root) {
  const io = captureIo();
  const code = await run(argv, io, new NodeSystem(cwd));
  return { code, out: io.out(), err: io.err() };
}

const CLEAN_MANIFEST = JSON.stringify(
  {
    name: 'fixture',
    version: '1.0.0',
    engines: { node: '>=20.19' },
    files: ['dist'],
  },
  null,
  2,
);

describe('validate against real directories', () => {
  it('exits 1 for a dependency in both dependency lists', async () => {
    await writeFileIn(
      root,
      'package.json',
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        engines: { node: '>=20.19' },
        files: ['dist'],
        dependencies: { shared: '^1.0.0' },
        devDependencies: { shared: '^2.0.0' },
      }),
    );
    await writeFileIn(root, 'package-lock.json', '{}');

    const { code, out } = await runIn(['validate']);

    expect(code).toBe(EXIT.FAILURE);
    expect(out).toContain('declared in both dependencies and devDependencies');
    expect(out).toContain('shared');
  });

  it('exits 0 for a clean fixture', async () => {
    await writeFileIn(root, 'package.json', CLEAN_MANIFEST);
    await writeFileIn(root, 'package-lock.json', '{}');
    await writeFileIn(
      root,
      'tsconfig.json',
      '{"compilerOptions":{"strict":true}}',
    );

    const { code, out } = await runIn(['validate']);

    expect(code).toBe(EXIT.SUCCESS);
    expect(out).not.toContain('FAIL');
  });

  it('exits 1 and names the path for a malformed package.json', async () => {
    await writeFileIn(root, 'package.json', '{ "name": "fixture", ');

    const { code, out, err } = await runIn(['validate']);

    expect(code).toBe(EXIT.FAILURE);
    expect(out).toContain('package.json');
    expect(out).toContain('FAIL');
    expect(hasStackFrame(out)).toBe(false);
    expect(hasStackFrame(err)).toBe(false);
  });

  it('exits 1 and names the path for an empty package.json', async () => {
    await writeFileIn(root, 'package.json', '');

    const { code, out } = await runIn(['validate']);

    expect(code).toBe(EXIT.FAILURE);
    expect(out).toContain('package.json: file is empty');
  });

  it('refuses a package.json larger than the read cap, naming the path', async () => {
    const padding = 'x'.repeat(2 * 1024 * 1024);
    await writeFileIn(
      root,
      'package.json',
      JSON.stringify({ name: 'fixture', version: '1.0.0', padding }),
    );

    const { code, out } = await runIn(['validate']);

    expect(code).toBe(EXIT.FAILURE);
    expect(out).toContain('package.json could not be read');
    expect(out).toContain('over the');
    expect(out).toContain('byte limit');
  });

  it('detects the package manager from each kind of lockfile', async () => {
    const expectations: readonly (readonly [string, string])[] = [
      ['package-lock.json', 'npm'],
      ['pnpm-lock.yaml', 'pnpm'],
      ['bun.lockb', 'bun'],
    ];

    for (const [file, manager] of expectations) {
      const fixture = await makeTempDir('sablectl-lock-');
      try {
        await writeFileIn(fixture, 'package.json', CLEAN_MANIFEST);
        await writeFileIn(fixture, file, '');

        const { code, out } = await runIn(['inspect', '--json'], fixture);
        const envelope = parseEnvelope(out);

        expect(code).toBe(EXIT.SUCCESS);
        expect(out).toContain(`"detected": "${manager}"`);
        expect(statusesById(envelope).has('project.packageManager')).toBe(true);
      } finally {
        await removeTempDir(fixture);
      }
    }
  });
});

describe('inspect against real directories', () => {
  it('terminates on a symlink loop and reports symlinks as not followed', async () => {
    await writeFileIn(root, 'package.json', CLEAN_MANIFEST);
    await mkdir(join(root, 'nested'), { recursive: true });
    await symlink(root, join(root, 'nested', 'loop'), 'dir');
    await symlink(join(root, 'nested'), join(root, 'self'), 'dir');
    await symlink('/', join(root, 'everything'), 'dir');

    const { code, out } = await runIn(['inspect', '--json']);
    const envelope = parseEnvelope(out);

    expect(code).toBe(EXIT.SUCCESS);
    expect(statusesById(envelope).get('project.layout')).toBe('info');
    expect(out).toContain('symlink(s) not followed');
    expect(out).toMatch(/"symlinksSkipped": [1-9]/);
  });

  it('exits 2 for a --path that escapes the working directory', async () => {
    await writeFileIn(root, 'package.json', CLEAN_MANIFEST);

    const { code, out, err } = await runIn(['inspect', '--path', '../../etc']);

    expect(code).toBe(EXIT.USAGE);
    expect(out).toBe('');
    expect(err).toContain('must stay within the working directory');
    expect(hasStackFrame(err)).toBe(false);
  });

  it('accepts a --path pointing at a subdirectory', async () => {
    await writeFileIn(root, 'packages/app/package.json', CLEAN_MANIFEST);

    const { code, out } = await runIn([
      'inspect',
      '--path',
      'packages/app',
      '--json',
    ]);

    expect(code).toBe(EXIT.SUCCESS);
    expect(parseEnvelope(out)['command']).toBe('inspect');
  });

  it('fails the manifest check for malformed JSON without crashing', async () => {
    await writeFile(join(root, 'package.json'), '{ oops', 'utf8');

    const { code, out, err } = await runIn(['inspect']);

    expect(code).toBe(EXIT.FAILURE);
    expect(out).toContain('package.json could not be parsed');
    expect(hasStackFrame(out)).toBe(false);
    expect(hasStackFrame(err)).toBe(false);
  });
});
