import { describe, expect, it } from 'vitest';
import {
  closestMatch,
  editDistance,
  flag,
  GLOBAL_FLAGS,
  option,
  parseArgs,
  type FlagSpec,
} from '../../../src/core/args.js';
import { UsageError } from '../../../src/core/errors.js';

const COMMAND_FLAGS: readonly FlagSpec[] = [
  { name: 'path', type: 'string', value: '<dir>', description: 'Path.' },
  { name: 'strict', type: 'boolean', description: 'Strict.' },
  { name: 'out', short: 'o', type: 'string', description: 'Output.' },
];

function parse(argv: readonly string[]) {
  return parseArgs(argv, (command) =>
    command === 'demo' ? COMMAND_FLAGS : undefined,
  );
}

describe('parseArgs', () => {
  it('returns no command and no flags for an empty argv', () => {
    const result = parse([]);
    expect(result.command).toBeUndefined();
    expect(result.positionals).toEqual([]);
    expect(result.flags.booleans.size).toBe(0);
    expect(result.flags.strings.size).toBe(0);
  });

  it('reads the command and long boolean flags', () => {
    const result = parse(['demo', '--json', '--strict']);
    expect(result.command).toBe('demo');
    expect(flag(result.flags, 'json')).toBe(true);
    expect(flag(result.flags, 'strict')).toBe(true);
    expect(flag(result.flags, 'verbose')).toBe(false);
  });

  it('reads short flags', () => {
    const result = parse(['-h']);
    expect(flag(result.flags, 'help')).toBe(true);
  });

  it('expands a -abc cluster into separate boolean flags', () => {
    const result = parse(['demo', '-hvV']);
    expect(flag(result.flags, 'help')).toBe(true);
    expect(flag(result.flags, 'verbose')).toBe(true);
    expect(flag(result.flags, 'version')).toBe(true);
  });

  it('lets a string short flag consume the rest of a cluster', () => {
    const result = parse(['demo', '-ofile.txt']);
    expect(option(result.flags, 'out')).toBe('file.txt');
  });

  it('lets a string short flag consume the next argument', () => {
    const result = parse(['demo', '-o', 'file.txt', 'extra']);
    expect(option(result.flags, 'out')).toBe('file.txt');
    expect(result.positionals).toEqual(['extra']);
  });

  it('accepts --flag=value', () => {
    const result = parse(['demo', '--path=sub/dir']);
    expect(option(result.flags, 'path')).toBe('sub/dir');
  });

  it('lets a string flag consume the next token', () => {
    const result = parse(['demo', '--path', 'sub/dir']);
    expect(option(result.flags, 'path')).toBe('sub/dir');
    expect(result.positionals).toEqual([]);
  });

  it('rejects a string flag with no value', () => {
    expect(() => parse(['demo', '--path'])).toThrow(UsageError);
    expect(() => parse(['demo', '--path', '--json'])).toThrow(
      /requires a value/,
    );
  });

  it('rejects a value given to a boolean flag', () => {
    expect(() => parse(['demo', '--strict=yes'])).toThrow(
      /does not take a value/,
    );
  });

  it('treats everything after -- as a positional, flag-shaped or not', () => {
    const result = parse(['demo', '--', '--json', '-h', 'file']);
    expect(result.command).toBe('demo');
    expect(result.positionals).toEqual(['--json', '-h', 'file']);
    expect(flag(result.flags, 'json')).toBe(false);
    expect(flag(result.flags, 'help')).toBe(false);
  });

  it('raises a UsageError for an unknown long flag', () => {
    expect(() => parse(['demo', '--nope'])).toThrow(UsageError);
    try {
      parse(['demo', '--nope']);
      expect.unreachable('expected a UsageError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).message).toBe("unknown option '--nope'");
    }
  });

  it('raises a UsageError for an unknown short flag', () => {
    expect(() => parse(['demo', '-q'])).toThrow("unknown option '-q'");
  });

  it('suggests a close long flag in the hint', () => {
    try {
      parse(['demo', '--stict']);
      expect.unreachable('expected a UsageError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).hint).toBe("did you mean '--strict'?");
    }
  });

  it('treats --no-x as the negation of a declared boolean x', () => {
    const result = parse(['demo', '--strict', '--no-strict']);
    expect(result.flags.booleans.get('strict')).toBe(false);
    expect(flag(result.flags, 'strict')).toBe(false);
  });

  it('keeps --no-color as a flag in its own right', () => {
    const result = parse(['demo', '--no-color']);
    expect(flag(result.flags, 'no-color')).toBe(true);
    expect(result.flags.booleans.has('color')).toBe(false);
  });

  it('rejects --no-x when x is not a declared boolean', () => {
    expect(() => parse(['demo', '--no-path'])).toThrow(
      "unknown option '--no-path'",
    );
  });

  it('only accepts command flags once the command has been seen', () => {
    expect(() => parse(['--path', 'x', 'demo'])).toThrow(
      "unknown option '--path'",
    );
  });

  it('keeps later bare tokens as positionals', () => {
    const result = parse(['help', 'git', 'extra']);
    expect(result.command).toBe('help');
    expect(result.positionals).toEqual(['git', 'extra']);
  });

  it('declares every global flag with a description', () => {
    for (const spec of GLOBAL_FLAGS) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.name).not.toBe('');
    }
  });
});

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('doctor', 'doctor')).toBe(0);
    expect(editDistance('', '')).toBe(0);
  });

  it('counts a single insertion, deletion and substitution as one', () => {
    expect(editDistance('doctor', 'doctors')).toBe(1);
    expect(editDistance('doctor', 'octor')).toBe(1);
    expect(editDistance('doctor', 'dactor')).toBe(1);
  });

  it('counts a transposition as one edit', () => {
    expect(editDistance('doctor', 'docotr')).toBe(1);
    expect(editDistance('validate', 'vaildate')).toBe(1);
  });

  it('equals the length of the other string when one is empty', () => {
    expect(editDistance('', 'inspect')).toBe(7);
    expect(editDistance('inspect', '')).toBe(7);
  });

  it('is symmetric', () => {
    expect(editDistance('inspect', 'inspcet')).toBe(
      editDistance('inspcet', 'inspect'),
    );
  });
});

describe('closestMatch', () => {
  const candidates = ['doctor', 'env', 'git', 'inspect', 'validate'];

  it('suggests the obvious typo', () => {
    expect(closestMatch('doctr', candidates)).toBe('doctor');
    expect(closestMatch('inspct', candidates)).toBe('inspect');
    expect(closestMatch('validte', candidates)).toBe('validate');
  });

  it('ignores case', () => {
    expect(closestMatch('DOCTOR', candidates)).toBe('doctor');
  });

  it('offers no suggestion for an unrelated word', () => {
    expect(closestMatch('photosynthesis', candidates)).toBeUndefined();
    expect(closestMatch('zzzzzzzzzz', candidates)).toBeUndefined();
  });

  it('offers no suggestion when there are no candidates', () => {
    expect(closestMatch('doctor', [])).toBeUndefined();
  });
});
