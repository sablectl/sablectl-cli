import { describe, expect, it } from 'vitest';
import {
  detectFromLockfiles,
  LOCKFILES,
  managerFromField,
} from '../../../src/parse/lockfile.js';

describe('detectFromLockfiles', () => {
  it('finds nothing in a directory with no lockfile', () => {
    expect(detectFromLockfiles(['package.json', 'src'])).toEqual({
      managers: [],
      files: [],
    });
  });

  it('maps each known lockfile to its manager', () => {
    for (const marker of LOCKFILES) {
      expect(detectFromLockfiles(['package.json', marker.file])).toEqual({
        managers: [marker.manager],
        files: [marker.file],
      });
    }
  });

  it('detects npm, pnpm, yarn, bun and deno individually', () => {
    expect(detectFromLockfiles(['package-lock.json']).managers).toEqual([
      'npm',
    ]);
    expect(detectFromLockfiles(['pnpm-lock.yaml']).managers).toEqual(['pnpm']);
    expect(detectFromLockfiles(['yarn.lock']).managers).toEqual(['yarn']);
    expect(detectFromLockfiles(['bun.lockb']).managers).toEqual(['bun']);
    expect(detectFromLockfiles(['deno.lock']).managers).toEqual(['deno']);
  });

  it('reports every lockfile present, not merely the first', () => {
    const detection = detectFromLockfiles([
      'yarn.lock',
      'package-lock.json',
      'pnpm-lock.yaml',
    ]);

    expect(detection.files).toEqual([
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
    ]);
    expect(detection.managers).toEqual(['npm', 'pnpm', 'yarn']);
  });

  it('collapses two lockfiles of the same manager to one manager', () => {
    const detection = detectFromLockfiles([
      'package-lock.json',
      'npm-shrinkwrap.json',
    ]);

    expect(detection.files).toEqual([
      'package-lock.json',
      'npm-shrinkwrap.json',
    ]);
    expect(detection.managers).toEqual(['npm']);
  });

  it('ignores a file that merely resembles a lockfile', () => {
    expect(detectFromLockfiles(['package-lock.json.bak']).files).toEqual([]);
  });
});

describe('managerFromField', () => {
  it('reads the manager out of a Corepack-style field', () => {
    expect(managerFromField('pnpm@9.1.0')).toBe('pnpm');
    expect(managerFromField('npm@10.8.0')).toBe('npm');
    expect(managerFromField('yarn@4.1.0')).toBe('yarn');
    expect(managerFromField('bun@1.1.0')).toBe('bun');
    expect(managerFromField('deno@2.0.0')).toBe('deno');
  });

  it('accepts a bare manager name and ignores case and spacing', () => {
    expect(managerFromField('pnpm')).toBe('pnpm');
    expect(managerFromField(' PNPM @9.1.0')).toBe('pnpm');
  });

  it('returns undefined rather than guessing', () => {
    expect(managerFromField(undefined)).toBeUndefined();
    expect(managerFromField('')).toBeUndefined();
    expect(managerFromField('npmm@1.0.0')).toBeUndefined();
    expect(managerFromField('corepack@0.1.0')).toBeUndefined();
  });
});
