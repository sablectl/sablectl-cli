import type { CheckResult, CheckStatus, Report } from '../../src/core/check.js';

/**
 * One report fixture carrying every status, shared by the renderer tests so
 * the human and JSON views are compared against identical input.
 */
export function sampleReport(command = 'doctor'): Report {
  const results: CheckResult[] = [
    {
      id: 'a.fail',
      title: 'Failing check',
      status: 'fail',
      summary: 'something is wrong',
      detail: { reason: 'broken', count: 2 },
      remediation: 'Fix it.',
    },
    {
      id: 'b.warn',
      title: 'Warning check',
      status: 'warn',
      summary: 'something is suspicious',
      remediation: 'Look at it.',
    },
    { id: 'c.pass', title: 'Passing check', status: 'pass', summary: 'fine' },
    { id: 'd.info', title: 'Informational', status: 'info', summary: 'noted' },
    { id: 'e.skip', title: 'Skipped', status: 'skip', summary: 'not run' },
  ];

  return {
    command,
    version: '9.9.9',
    generatedAt: '2024-01-02T03:04:05.000Z',
    sections: [
      { title: 'First', results },
      { title: 'Empty', results: [] },
    ],
  };
}

export const ALL_STATUSES: readonly CheckStatus[] = [
  'pass',
  'warn',
  'fail',
  'info',
  'skip',
];

export function reportOf(results: readonly CheckResult[]): Report {
  return {
    command: 'test',
    version: '0.0.0',
    generatedAt: '2024-01-02T03:04:05.000Z',
    sections: [{ title: 'Section', results }],
  };
}

export function check(
  id: string,
  status: CheckStatus,
  summary = 'summary',
): CheckResult {
  return { id, title: id, status, summary };
}
