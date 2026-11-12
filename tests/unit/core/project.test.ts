import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../../../src/core/errors.js';
import { resolveProjectPath } from '../../../src/core/project.js';

const CWD = '/home/tester/project';

describe('resolveProjectPath', () => {
  it('returns the working directory when nothing is requested', () => {
    expect(resolveProjectPath(CWD, undefined)).toBe(resolve(CWD));
    expect(resolveProjectPath(CWD, '')).toBe(resolve(CWD));
  });

  it('accepts the working directory itself', () => {
    expect(resolveProjectPath(CWD, '.')).toBe(resolve(CWD));
    expect(resolveProjectPath(CWD, CWD)).toBe(resolve(CWD));
  });

  it('accepts a subdirectory, relative or absolute', () => {
    expect(resolveProjectPath(CWD, 'packages/core')).toBe(
      resolve(CWD, 'packages/core'),
    );
    expect(resolveProjectPath(CWD, './packages/core')).toBe(
      resolve(CWD, 'packages/core'),
    );
    expect(resolveProjectPath(CWD, `${CWD}/packages/core`)).toBe(
      resolve(CWD, 'packages/core'),
    );
  });

  it('accepts a path that only looks like an escape', () => {
    expect(resolveProjectPath(CWD, 'packages/../src')).toBe(
      resolve(CWD, 'src'),
    );
  });

  it('rejects a relative escape with a UsageError', () => {
    for (const requested of ['..', '../..', '../sibling', 'packages/../../x']) {
      expect(() => resolveProjectPath(CWD, requested)).toThrow(UsageError);
      expect(() => resolveProjectPath(CWD, requested)).toThrow(
        /must stay within the working directory/,
      );
    }
  });

  it('rejects an absolute path outside the working directory', () => {
    expect(() => resolveProjectPath(CWD, '/etc')).toThrow(UsageError);
    expect(() => resolveProjectPath(CWD, '/home/tester')).toThrow(UsageError);
  });

  it('names the offending value and suggests the correction', () => {
    try {
      resolveProjectPath(CWD, '../../etc');
      expect.unreachable('expected a UsageError');
    } catch (error: unknown) {
      if (!(error instanceof UsageError)) throw error;
      expect(error.message).toContain("'../../etc'");
      expect(error.hint).toContain('change directory');
    }
  });

  it('rejects a sibling directory that shares a name prefix', () => {
    expect(() => resolveProjectPath(CWD, '../project-two')).toThrow(UsageError);
  });
});
