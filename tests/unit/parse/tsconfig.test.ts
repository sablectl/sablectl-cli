import { describe, expect, it } from 'vitest';
import {
  parseTsConfig,
  stripJsonComments,
  type TsConfig,
} from '../../../src/parse/tsconfig.js';

function value(raw: string, path = 'tsconfig.json'): TsConfig {
  const result = parseTsConfig(path, raw);
  if (!result.ok) {
    throw new Error(`expected a parse, got: ${result.error.reason}`);
  }
  return result.value;
}

function failure(raw: string, path = 'tsconfig.json') {
  const result = parseTsConfig(path, raw);
  if (result.ok) {
    throw new Error('expected a parse failure');
  }
  return result.error;
}

describe('stripJsonComments', () => {
  it('removes a line comment but keeps the newline', () => {
    expect(stripJsonComments('{\n  // a comment\n  "a": 1\n}')).toBe(
      '{\n  \n  "a": 1\n}',
    );
  });

  it('removes a trailing line comment after a value', () => {
    expect(stripJsonComments('{"a": 1 // why\n}')).toBe('{"a": 1 \n}');
  });

  it('removes a block comment, including a multi-line one', () => {
    expect(stripJsonComments('{/* note */"a": 1}')).toBe('{"a": 1}');
    expect(stripJsonComments('{\n/* one\n   two */\n"a": 1}')).toBe(
      '{\n\n"a": 1}',
    );
  });

  it('removes a trailing comma before } and ]', () => {
    expect(stripJsonComments('{"a": [1, 2, ], }')).toBe('{"a": [1, 2 ] }');
  });

  it('removes a trailing comma hidden behind a comment', () => {
    const revived: unknown = JSON.parse(
      stripJsonComments('{"a": 1, // last\n}'),
    );
    expect(revived).toEqual({ a: 1 });
  });

  it('preserves a comment marker inside a string value', () => {
    const raw = '{"outDir": "./dist", "note": "https://example.com/* x */"}';
    expect(stripJsonComments(raw)).toBe(raw);

    const parsedValue: unknown = JSON.parse(stripJsonComments(raw));
    expect(parsedValue).toEqual({
      outDir: './dist',
      note: 'https://example.com/* x */',
    });
  });

  it('preserves an escaped quote inside a string', () => {
    const raw = '{"a": "say \\"hi\\" // not a comment"}';
    expect(stripJsonComments(raw)).toBe(raw);
  });

  it('leaves comment-free input untouched', () => {
    expect(stripJsonComments('{"a":1}')).toBe('{"a":1}');
    expect(stripJsonComments('')).toBe('');
  });
});

describe('parseTsConfig', () => {
  it('reads strict and the rest of the compiler options', () => {
    const config = value(
      `{
        // The project configuration.
        "extends": "./base.json",
        "compilerOptions": {
          "strict": true,
          "target": "ES2023",
          "module": "NodeNext",
          "moduleResolution": "nodenext",
          "outDir": "dist", /* build output */
          "noUncheckedIndexedAccess": true,
          "exactOptionalPropertyTypes": false,
        },
      }`,
    );

    expect(config.strict).toBe(true);
    expect(config.target).toBe('ES2023');
    expect(config.module).toBe('NodeNext');
    expect(config.moduleResolution).toBe('nodenext');
    expect(config.outDir).toBe('dist');
    expect(config.extends).toBe('./base.json');
    expect(config.strictFamily).toEqual({
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: false,
    });
  });

  it('distinguishes strict false from strict absent', () => {
    expect(value('{"compilerOptions":{"strict":false}}').strict).toBe(false);
    expect(value('{"compilerOptions":{}}').strict).toBeUndefined();
    expect(value('{}').strict).toBeUndefined();
    expect(
      value('{"compilerOptions":{"strict":"true"}}').strict,
    ).toBeUndefined();
  });

  it('ignores a non-object compilerOptions rather than failing', () => {
    const config = value('{"compilerOptions": "strict"}');
    expect(config.strict).toBeUndefined();
    expect(config.strictFamily).toEqual({});
  });

  it('reports an empty file, malformed JSON and a non-object top level', () => {
    expect(failure('', 'a/tsconfig.json')).toEqual({
      path: 'a/tsconfig.json',
      reason: 'file is empty',
    });
    expect(failure('{"compilerOptions": }').reason.length).toBeGreaterThan(0);
    expect(failure('[]').reason).toBe('top-level value is not an object');
  });
});
