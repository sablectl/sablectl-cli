import { describe, expect, it } from 'vitest';
import {
  bySeverityThenId,
  compareSeverity,
  exitCodeFor,
  severityOf,
  tally,
  worstStatus,
  type CheckStatus,
} from '../../../src/core/check.js';
import { EXIT } from '../../../src/core/errors.js';
import { ALL_STATUSES, check, reportOf } from '../../helpers/report.js';

describe('severity ordering', () => {
  it('ranks skip below info below pass below warn below fail', () => {
    const ordered: readonly CheckStatus[] = [
      'skip',
      'info',
      'pass',
      'warn',
      'fail',
    ];
    const severities = ordered.map(severityOf);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
    expect(new Set(severities).size).toBe(ordered.length);
  });

  it('compares two statuses by severity', () => {
    expect(compareSeverity('fail', 'warn')).toBeGreaterThan(0);
    expect(compareSeverity('warn', 'pass')).toBeGreaterThan(0);
    expect(compareSeverity('pass', 'info')).toBeGreaterThan(0);
    expect(compareSeverity('info', 'skip')).toBeGreaterThan(0);
    expect(compareSeverity('pass', 'fail')).toBeLessThan(0);
    expect(compareSeverity('warn', 'warn')).toBe(0);
  });
});

describe('worstStatus', () => {
  it('returns pass for a report with no results at all', () => {
    expect(worstStatus(reportOf([]))).toBe('pass');
  });

  it('returns the single worst status across every section', () => {
    expect(worstStatus(reportOf([check('a', 'pass')]))).toBe('pass');
    expect(
      worstStatus(reportOf([check('a', 'pass'), check('b', 'warn')])),
    ).toBe('warn');
    expect(
      worstStatus(reportOf([check('a', 'warn'), check('b', 'fail')])),
    ).toBe('fail');
  });

  it('does not let info or skip lower the baseline', () => {
    expect(
      worstStatus(reportOf([check('a', 'info'), check('b', 'skip')])),
    ).toBe('pass');
  });

  it('considers results in every section, not only the first', () => {
    const report = {
      command: 'test',
      version: '0.0.0',
      generatedAt: '2024-01-02T03:04:05.000Z',
      sections: [
        { title: 'First', results: [check('a', 'pass')] },
        { title: 'Second', results: [check('b', 'fail')] },
      ],
    };
    expect(worstStatus(report)).toBe('fail');
  });
});

describe('tally', () => {
  it('counts every status and reports zero for the absent ones', () => {
    const counts = tally(reportOf([]));
    expect(counts).toEqual({ pass: 0, warn: 0, fail: 0, info: 0, skip: 0 });
  });

  it('counts each status across sections', () => {
    const report = {
      command: 'test',
      version: '0.0.0',
      generatedAt: '2024-01-02T03:04:05.000Z',
      sections: [
        {
          title: 'First',
          results: [check('a', 'pass'), check('b', 'pass'), check('c', 'warn')],
        },
        {
          title: 'Second',
          results: [check('d', 'fail'), check('e', 'info'), check('f', 'skip')],
        },
      ],
    };
    expect(tally(report)).toEqual({
      pass: 2,
      warn: 1,
      fail: 1,
      info: 1,
      skip: 1,
    });
  });

  it('sums to the number of results', () => {
    const results = ALL_STATUSES.map((status, index) =>
      check(`id${String(index)}`, status),
    );
    const counts = tally(reportOf(results));
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(results.length);
  });
});

describe('bySeverityThenId', () => {
  it('orders worst first, then by id, without mutating the input', () => {
    const input = [
      check('z.pass', 'pass'),
      check('a.fail', 'fail'),
      check('m.warn', 'warn'),
      check('b.fail', 'fail'),
      check('a.skip', 'skip'),
      check('a.info', 'info'),
    ];
    const copy = [...input];

    const sorted = bySeverityThenId(input).map((result) => result.id);

    expect(sorted).toEqual([
      'a.fail',
      'b.fail',
      'm.warn',
      'z.pass',
      'a.info',
      'a.skip',
    ]);
    expect(input).toEqual(copy);
  });

  it('is stable for an empty list', () => {
    expect(bySeverityThenId([])).toEqual([]);
  });
});

describe('exitCodeFor', () => {
  it('exits 0 when everything passes', () => {
    expect(exitCodeFor(reportOf([check('a', 'pass')]))).toBe(EXIT.SUCCESS);
  });

  it('exits 0 for info and skip only', () => {
    expect(
      exitCodeFor(reportOf([check('a', 'info'), check('b', 'skip')])),
    ).toBe(EXIT.SUCCESS);
  });

  it('exits 0 for a warning normally and 1 under strict', () => {
    const report = reportOf([check('a', 'pass'), check('b', 'warn')]);
    expect(exitCodeFor(report)).toBe(EXIT.SUCCESS);
    expect(exitCodeFor(report, false)).toBe(EXIT.SUCCESS);
    expect(exitCodeFor(report, true)).toBe(EXIT.FAILURE);
  });

  it('exits 1 for a failure whether or not strict is set', () => {
    const report = reportOf([check('a', 'fail')]);
    expect(exitCodeFor(report)).toBe(EXIT.FAILURE);
    expect(exitCodeFor(report, true)).toBe(EXIT.FAILURE);
  });

  it('exits 0 for an empty report, strict or not', () => {
    expect(exitCodeFor(reportOf([]))).toBe(EXIT.SUCCESS);
    expect(exitCodeFor(reportOf([]), true)).toBe(EXIT.SUCCESS);
  });
});
