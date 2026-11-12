import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '../../../src/parse/manifest.js';

function value(raw: string, path = 'package.json'): Manifest {
  const result = parseManifest(path, raw);
  if (!result.ok) {
    throw new Error(`expected a parse, got: ${result.error.reason}`);
  }
  return result.value;
}

function failure(raw: string, path = 'package.json') {
  const result = parseManifest(path, raw);
  if (result.ok) {
    throw new Error('expected a parse failure');
  }
  return result.error;
}

describe('parseManifest', () => {
  it('parses a conventional manifest', () => {
    const manifest = value(
      JSON.stringify({
        name: 'demo',
        version: '1.2.3',
        description: 'A demo.',
        private: true,
        type: 'module',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        packageManager: 'pnpm@9.1.0',
        engines: { node: '>=20.19' },
        scripts: { build: 'tsc', test: 'vitest run' },
        dependencies: { left: '^1.0.0' },
        devDependencies: { right: '^2.0.0' },
        peerDependencies: { peer: '^3.0.0' },
        optionalDependencies: { optional: '^4.0.0' },
        files: ['dist', 'README.md'],
      }),
    );

    expect(manifest.name).toBe('demo');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.description).toBe('A demo.');
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe('module');
    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.types).toBe('./dist/index.d.ts');
    expect(manifest.packageManager).toBe('pnpm@9.1.0');
    expect(manifest.engines).toEqual({ node: '>=20.19' });
    expect(Object.keys(manifest.scripts)).toEqual(['build', 'test']);
    expect(manifest.dependencies).toEqual({ left: '^1.0.0' });
    expect(manifest.devDependencies).toEqual({ right: '^2.0.0' });
    expect(manifest.peerDependencies).toEqual({ peer: '^3.0.0' });
    expect(manifest.optionalDependencies).toEqual({ optional: '^4.0.0' });
    expect(manifest.files).toEqual(['dist', 'README.md']);
  });

  it('defaults every collection when the manifest is minimal', () => {
    const manifest = value('{}');

    expect(manifest.name).toBeUndefined();
    expect(manifest.private).toBe(false);
    expect(manifest.engines).toEqual({});
    expect(manifest.scripts).toEqual({});
    expect(manifest.dependencies).toEqual({});
    expect(manifest.workspaces).toEqual([]);
    expect(manifest.files).toEqual([]);
    expect(manifest.bin).toEqual({});
    expect(manifest.exportPaths).toEqual([]);
  });

  it('reports an empty file as a failure naming the path', () => {
    expect(failure('', 'pkg/package.json')).toEqual({
      path: 'pkg/package.json',
      reason: 'file is empty',
    });
    expect(failure('   \n\t ').reason).toBe('file is empty');
  });

  it('reports malformed JSON as a failure naming the path', () => {
    const error = failure('{ "name": "demo", }', 'a/package.json');
    expect(error.path).toBe('a/package.json');
    expect(error.reason.length).toBeGreaterThan(0);
  });

  it('reports a non-object top level as a failure', () => {
    for (const raw of ['[]', '"demo"', '42', 'null', 'true']) {
      expect(failure(raw).reason).toBe('top-level value is not an object');
    }
  });

  it('normalises a string bin to the package name', () => {
    expect(value('{"name":"demo","bin":"./cli.js"}').bin).toEqual({
      demo: './cli.js',
    });
  });

  it('falls back to a bin key when the package has no name', () => {
    expect(value('{"bin":"./cli.js"}').bin).toEqual({ bin: './cli.js' });
  });

  it('keeps an object bin as declared and drops non-string values', () => {
    expect(value('{"name":"demo","bin":{"a":"./a.js","b":7}}').bin).toEqual({
      a: './a.js',
    });
  });

  it('flattens nested exports conditions into relative paths', () => {
    const manifest = value(
      JSON.stringify({
        exports: {
          '.': {
            import: { types: './dist/index.d.ts', default: './dist/index.js' },
            require: './dist/index.cjs',
          },
          './sub': ['./dist/sub.js', 'not-relative'],
        },
      }),
    );

    expect([...manifest.exportPaths].sort()).toEqual([
      './dist/index.cjs',
      './dist/index.d.ts',
      './dist/index.js',
      './dist/sub.js',
    ]);
  });

  it('accepts a plain string exports field', () => {
    expect(value('{"exports":"./dist/index.js"}').exportPaths).toEqual([
      './dist/index.js',
    ]);
  });

  it('reads workspaces in both the array and the packages form', () => {
    expect(value('{"workspaces":["packages/*","apps/*"]}').workspaces).toEqual([
      'packages/*',
      'apps/*',
    ]);
    expect(
      value('{"workspaces":{"packages":["packages/*"]}}').workspaces,
    ).toEqual(['packages/*']);
    expect(value('{"workspaces":{"nohoist":[]}}').workspaces).toEqual([]);
    expect(value('{"workspaces":"packages/*"}').workspaces).toEqual([]);
  });

  it('survives junk types without throwing', () => {
    const manifest = value(
      JSON.stringify({
        name: 42,
        version: null,
        scripts: 'build',
        dependencies: null,
        devDependencies: ['left'],
        engines: 'node',
        files: 'dist',
        private: 'yes',
        exports: 7,
      }),
    );

    expect(manifest.name).toBeUndefined();
    expect(manifest.version).toBeUndefined();
    expect(manifest.scripts).toEqual({});
    expect(manifest.dependencies).toEqual({});
    expect(manifest.devDependencies).toEqual({});
    expect(manifest.engines).toEqual({});
    expect(manifest.files).toEqual([]);
    expect(manifest.private).toBe(false);
    expect(manifest.exportPaths).toEqual([]);
  });

  it('keeps only the string entries of a mixed array field', () => {
    expect(value('{"files":["dist",7,null,"LICENSE"]}').files).toEqual([
      'dist',
      'LICENSE',
    ]);
  });

  it('bounds how deeply exports are followed', () => {
    let nested: unknown = './dist/too-deep.js';
    for (let depth = 0; depth < 9; depth += 1) {
      nested = { import: nested };
    }

    const manifest = value(JSON.stringify({ exports: nested }));
    expect(manifest.exportPaths).toEqual([]);
  });
});
