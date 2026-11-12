import { describe, expect, it } from 'vitest';
import type { CheckResult, CheckStatus } from '../../../src/core/check.js';
import {
  collectEnvChecks,
  envCommand,
  formatBytes,
  SUPPORTED_NODE_RANGE,
} from '../../../src/commands/env.js';
import { resolveStyle } from '../../../src/core/render/style.js';
import { createFakeSystem } from '../../helpers/fake-system.js';
import type { ExecResult } from '../../../src/platform/types.js';

function ran(stdout: string): ExecResult {
  return { ran: true, code: 0, stdout, stderr: '' };
}

const MISSING: ExecResult = {
  ran: false,
  code: null,
  stdout: '',
  stderr: '',
  error: 'executable not found',
};

function statusOf(results: readonly CheckResult[], id: string): CheckStatus {
  const result = results.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`no check '${id}'`);
  return result.status;
}

function summaryOf(results: readonly CheckResult[], id: string): string {
  const result = results.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`no check '${id}'`);
  return result.summary;
}

describe('collectEnvChecks', () => {
  it('fails the Node check for a version below the supported range', async () => {
    const system = createFakeSystem({ nodeVersion: '18.20.4' });
    const results = await collectEnvChecks(system);

    expect(statusOf(results, 'node.version')).toBe('fail');
    expect(summaryOf(results, 'node.version')).toContain(SUPPORTED_NODE_RANGE);
    expect(summaryOf(results, 'node.version')).toContain('18.20.4');

    const node = results.find((result) => result.id === 'node.version');
    expect(node?.remediation).toBeDefined();
  });

  it('passes the Node check for a version inside the supported range', async () => {
    for (const version of ['20.19.0', '22.11.0', '24.0.0']) {
      const results = await collectEnvChecks(
        createFakeSystem({ nodeVersion: version }),
      );
      expect(statusOf(results, 'node.version')).toBe('pass');
      expect(summaryOf(results, 'node.version')).toContain(
        `v${version} satisfies`,
      );
    }
  });

  it('warns rather than passing when the version cannot be compared', async () => {
    const results = await collectEnvChecks(
      createFakeSystem({ nodeVersion: 'nightly' }),
    );
    expect(statusOf(results, 'node.version')).toBe('warn');
    expect(summaryOf(results, 'node.version')).toContain(
      'could not be compared',
    );
  });

  it('reports the operating system, CPU and memory as information', async () => {
    const system = createFakeSystem({
      os: { type: 'Linux', release: '6.1.0', arch: 'arm64', cpus: 1 },
    });
    const results = await collectEnvChecks(system);

    expect(statusOf(results, 'os.platform')).toBe('info');
    expect(summaryOf(results, 'os.platform')).toBe('Linux 6.1.0 (linux)');
    expect(summaryOf(results, 'os.cpu')).toBe('arm64, 1 logical core');
    expect(statusOf(results, 'os.memory')).toBe('info');
  });

  it('reports an installed package manager as a pass and an absent one as info', async () => {
    const system = createFakeSystem({
      exec: (file) => (file === 'pnpm' ? ran('v9.1.0\n') : MISSING),
    });
    const results = await collectEnvChecks(system);

    expect(statusOf(results, 'packageManager.pnpm')).toBe('pass');
    expect(summaryOf(results, 'packageManager.pnpm')).toBe('v9.1.0');
    expect(statusOf(results, 'packageManager.npm')).toBe('info');
    expect(summaryOf(results, 'packageManager.npm')).toBe('not installed');
  });

  it('probes each package manager with a version argument and no shell', async () => {
    const system = createFakeSystem({ exec: () => MISSING });
    await collectEnvChecks(system);

    const probes = system.execCalls.filter((call) =>
      ['npm', 'pnpm', 'yarn', 'bun'].includes(call.file),
    );
    expect(probes).toHaveLength(4);
    for (const probe of probes) {
      expect(probe.args).toEqual(['--version']);
    }
  });

  it('reports the shell from the environment, or says it is unreported', async () => {
    const withShell = await collectEnvChecks(
      createFakeSystem({ env: { SHELL: '/bin/zsh' } }),
    );
    expect(summaryOf(withShell, 'shell')).toBe('/bin/zsh');

    const withComSpec = await collectEnvChecks(
      createFakeSystem({ env: { ComSpec: 'C:\\cmd.exe' } }),
    );
    expect(summaryOf(withComSpec, 'shell')).toBe('C:\\cmd.exe');

    const without = await collectEnvChecks(createFakeSystem({ env: {} }));
    expect(summaryOf(without, 'shell')).toContain('not reported');
  });

  it('detects continuous integration by variable, honouring CI=false', async () => {
    const detected = await collectEnvChecks(
      createFakeSystem({ env: { CI: 'true', GITHUB_ACTIONS: 'true' } }),
    );
    expect(summaryOf(detected, 'ci')).toBe('detected via CI, GITHUB_ACTIONS');

    const declined = await collectEnvChecks(
      createFakeSystem({ env: { CI: 'false' } }),
    );
    expect(summaryOf(declined, 'ci')).toContain('not detected');
  });

  it('never reports a worse-than-info status for the informational checks', async () => {
    const results = await collectEnvChecks(
      createFakeSystem({ nodeVersion: '22.11.0' }),
    );
    for (const result of results) {
      expect(['pass', 'info']).toContain(result.status);
      expect(result.summary).not.toBe('');
    }
  });
});

describe('formatBytes', () => {
  it('scales to the largest sensible unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(16 * 1024 * 1024 * 1024)).toBe('16 GiB');
  });

  it('refuses to invent a number for nonsense input', () => {
    expect(formatBytes(-1)).toBe('unknown');
    expect(formatBytes(Number.NaN)).toBe('unknown');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('unknown');
  });
});

describe('envCommand', () => {
  it('returns a one-section report stamped with the injected clock', async () => {
    const system = createFakeSystem({
      nodeVersion: '22.11.0',
      now: new Date('2024-05-06T07:08:09.000Z'),
    });

    const report = await envCommand.run({
      cwd: system.cwd,
      system,
      output: resolveStyle(system.terminal()),
      flags: { booleans: new Map(), strings: new Map() },
      positionals: [],
    });

    expect(report.command).toBe('env');
    expect(report.generatedAt).toBe('2024-05-06T07:08:09.000Z');
    expect(report.sections.map((section) => section.title)).toEqual([
      'Environment',
    ]);
    expect(report.sections[0]?.results.length).toBeGreaterThan(5);
  });
});
