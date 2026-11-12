import { describe, expect, it } from 'vitest';
import { isIgnored, parseGitignore } from '../../../src/parse/gitignore.js';

const CONTENT = [
  '# build output',
  'node_modules',
  '/dist',
  '*.log',
  '**/tmp',
  '!keep.log',
  'coverage/',
  '',
].join('\n');

const RULES = parseGitignore(CONTENT);

function ignoredFile(path: string): boolean {
  return isIgnored(RULES, path, false);
}

function ignoredDirectory(path: string): boolean {
  return isIgnored(RULES, path, true);
}

describe('parseGitignore', () => {
  it('skips blank lines and comments', () => {
    expect(RULES.map((rule) => rule.pattern)).toEqual([
      'node_modules',
      '/dist',
      '*.log',
      '**/tmp',
      'keep.log',
      'coverage',
    ]);
  });

  it('records negation and directory-only markers', () => {
    const negated = RULES.filter((rule) => rule.negated);
    expect(negated.map((rule) => rule.pattern)).toEqual(['keep.log']);

    const directoryOnly = RULES.filter((rule) => rule.directoryOnly);
    expect(directoryOnly.map((rule) => rule.pattern)).toEqual(['coverage']);
  });

  it('ignores a line consisting only of a slash', () => {
    expect(parseGitignore('/\n!/\n')).toEqual([]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseGitignore('dist\r\nbuild\r\n').map((r) => r.pattern)).toEqual([
      'dist',
      'build',
    ]);
  });
});

describe('isIgnored', () => {
  it('matches a bare name at any depth', () => {
    expect(ignoredDirectory('node_modules')).toBe(true);
    expect(ignoredDirectory('packages/app/node_modules')).toBe(true);
    expect(ignoredFile('node_modules/left-pad/index.js')).toBe(true);
  });

  it('anchors a leading-slash pattern to the root', () => {
    expect(ignoredDirectory('dist')).toBe(true);
    expect(ignoredFile('dist/index.js')).toBe(true);
    expect(ignoredDirectory('packages/app/dist')).toBe(false);
  });

  it('matches a wildcard extension at any depth', () => {
    expect(ignoredFile('debug.log')).toBe(true);
    expect(ignoredFile('logs/debug.log')).toBe(true);
    expect(ignoredFile('debug.log.txt')).toBe(false);
  });

  it('matches a ** segment at the root and below it', () => {
    expect(ignoredDirectory('tmp')).toBe(true);
    expect(ignoredDirectory('src/tmp')).toBe(true);
    expect(ignoredFile('src/a/b/tmp/file.txt')).toBe(true);
  });

  it('honours a later negation', () => {
    expect(ignoredFile('keep.log')).toBe(false);
    expect(ignoredFile('other.log')).toBe(true);
  });

  it('applies a directory-only rule to directories only', () => {
    expect(ignoredDirectory('coverage')).toBe(true);
    expect(ignoredFile('coverage')).toBe(false);
    expect(ignoredFile('coverage/lcov.info')).toBe(false);
  });

  it('leaves unmatched paths alone', () => {
    expect(ignoredFile('src/index.ts')).toBe(false);
    expect(ignoredDirectory('src')).toBe(false);
    expect(isIgnored([], 'anything', false)).toBe(false);
  });

  it('respects declaration order when a negation comes first', () => {
    const rules = parseGitignore('!keep.log\n*.log\n');
    expect(isIgnored(rules, 'keep.log', false)).toBe(true);
  });

  it('treats ? as a single-character wildcard', () => {
    const rules = parseGitignore('file?.txt\n');
    expect(isIgnored(rules, 'file1.txt', false)).toBe(true);
    expect(isIgnored(rules, 'file12.txt', false)).toBe(false);
  });

  it('escapes regular-expression metacharacters in a literal pattern', () => {
    const rules = parseGitignore('a+b.txt\n');
    expect(isIgnored(rules, 'a+b.txt', false)).toBe(true);
    expect(isIgnored(rules, 'aab.txt', false)).toBe(false);
  });
});
