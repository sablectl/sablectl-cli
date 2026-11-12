import { describe, expect, it } from 'vitest';
import { worstStatus } from '../../../src/core/check.js';
import { renderHuman } from '../../../src/core/render/human.js';
import {
  JSON_SCHEMA_VERSION,
  renderJson,
} from '../../../src/core/render/json.js';
import {
  paint,
  resolveStyle,
  statusLabel,
  STATUS_LABEL,
  type TerminalCapabilities,
} from '../../../src/core/render/style.js';
import {
  parseEnvelope,
  recordAt,
  recordsAt,
  stringAt,
} from '../../helpers/json.js';
import { ALL_STATUSES, sampleReport } from '../../helpers/report.js';

const ESC = '\u001B';

function caps(
  env: Readonly<Record<string, string | undefined>>,
  isTTY = false,
  columns: number | undefined = 80,
): TerminalCapabilities {
  return { isTTY, columns, env };
}

describe('resolveStyle colour precedence', () => {
  it('lets --no-color win over everything else', () => {
    const style = resolveStyle(caps({ FORCE_COLOR: '1' }, true), {
      noColor: true,
    });
    expect(style.color).toBe(false);
  });

  it('lets NO_COLOR win over TERM, FORCE_COLOR and a TTY', () => {
    const style = resolveStyle(
      caps({ NO_COLOR: '1', TERM: 'xterm', FORCE_COLOR: '1' }, true),
    );
    expect(style.color).toBe(false);
  });

  it('lets TERM=dumb win over FORCE_COLOR and a TTY', () => {
    const style = resolveStyle(caps({ TERM: 'dumb', FORCE_COLOR: '1' }, true));
    expect(style.color).toBe(false);
  });

  it('lets FORCE_COLOR re-enable colour when stdout is not a TTY', () => {
    expect(resolveStyle(caps({ FORCE_COLOR: '1' }, false)).color).toBe(true);
  });

  it('treats FORCE_COLOR=0 and an empty NO_COLOR as unset', () => {
    expect(resolveStyle(caps({ FORCE_COLOR: '0' }, false)).color).toBe(false);
    expect(resolveStyle(caps({ FORCE_COLOR: '0' }, true)).color).toBe(true);
    expect(resolveStyle(caps({ NO_COLOR: '' }, true)).color).toBe(true);
  });

  it('otherwise follows TTY detection', () => {
    expect(resolveStyle(caps({}, true)).color).toBe(true);
    expect(resolveStyle(caps({}, false)).color).toBe(false);
  });

  it('carries the verbose flag through untouched', () => {
    expect(resolveStyle(caps({}), { verbose: true }).verbose).toBe(true);
    expect(resolveStyle(caps({})).verbose).toBe(false);
  });

  it('clamps the terminal width into a readable range', () => {
    expect(resolveStyle(caps({}, false, undefined)).width).toBe(80);
    expect(resolveStyle(caps({}, false, 0)).width).toBe(80);
    expect(resolveStyle(caps({}, false, 10)).width).toBe(40);
    expect(resolveStyle(caps({}, false, 400)).width).toBe(120);
    expect(resolveStyle(caps({}, false, 100.7)).width).toBe(100);
  });
});

describe('paint', () => {
  it('wraps the value in escape codes only when colour is enabled', () => {
    const coloured = resolveStyle(caps({}, true));
    const plain = resolveStyle(caps({}, false));

    expect(paint(coloured, 'red', 'x')).toContain(ESC);
    expect(paint(coloured, 'red', 'x')).toContain('x');
    expect(paint(plain, 'red', 'x')).toBe('x');
  });

  it('states every status in words regardless of colour', () => {
    const plain = resolveStyle(caps({}, false));
    for (const status of ALL_STATUSES) {
      expect(statusLabel(plain, status)).toBe(STATUS_LABEL[status]);
      expect(STATUS_LABEL[status]).toBe(STATUS_LABEL[status].toUpperCase());
    }
  });
});

describe('renderHuman', () => {
  const report = sampleReport();

  it('is byte-identical under NO_COLOR, TERM=dumb and a non-TTY', () => {
    const noColorEnv = renderHuman(
      report,
      resolveStyle(caps({ NO_COLOR: '1' }, true)),
    );
    const dumbTerm = renderHuman(
      report,
      resolveStyle(caps({ TERM: 'dumb' }, true)),
    );
    const notATty = renderHuman(report, resolveStyle(caps({}, false)));
    const explicitFlag = renderHuman(
      report,
      resolveStyle(caps({}, true), { noColor: true }),
    );

    expect(dumbTerm).toBe(noColorEnv);
    expect(notATty).toBe(noColorEnv);
    expect(explicitFlag).toBe(noColorEnv);

    for (const output of [noColorEnv, dumbTerm, notATty, explicitFlag]) {
      expect(output).not.toContain(ESC);
    }
  });

  it('emits escape codes when colour is on, with the same words', () => {
    const coloured = renderHuman(report, resolveStyle(caps({}, true)));
    expect(coloured).toContain(ESC);
    for (const status of ALL_STATUSES) {
      expect(coloured).toContain(STATUS_LABEL[status]);
    }
  });

  it('carries every status word, title and summary', () => {
    const output = renderHuman(report, resolveStyle(caps({}, false)));

    for (const status of ALL_STATUSES) {
      expect(output).toContain(STATUS_LABEL[status]);
    }
    for (const section of report.sections) {
      expect(output).toContain(section.title);
      for (const result of section.results) {
        expect(output).toContain(result.title);
        expect(output).toContain(result.summary);
      }
    }
    expect(output).toContain('sablectl doctor');
    expect(output).toContain(`v${report.version}`);
  });

  it('names an empty section rather than omitting it', () => {
    const output = renderHuman(report, resolveStyle(caps({}, false)));
    expect(output).toContain('Empty');
    expect(output).toContain('(nothing to report)');
  });

  it('summarises the counts of each status present', () => {
    const output = renderHuman(report, resolveStyle(caps({}, false)));
    expect(output).toContain('1 fail, 1 warn, 1 pass, 1 info, 1 skip.');
  });

  it('says so when no checks ran', () => {
    const output = renderHuman(
      {
        command: 'env',
        version: '1.2.3',
        generatedAt: '2024-01-02T03:04:05.000Z',
        sections: [],
      },
      resolveStyle(caps({}, false)),
    );
    expect(output).toContain('no checks ran');
  });

  it('shows detail only in verbose mode', () => {
    const plain = renderHuman(report, resolveStyle(caps({}, false)));
    const verbose = renderHuman(
      report,
      resolveStyle(caps({}, false), { verbose: true }),
    );

    expect(plain).not.toContain('reason: broken');
    expect(verbose).toContain('reason: broken');
    expect(verbose).toContain('count: 2');
  });

  it('shows the remediation for a failing check', () => {
    const output = renderHuman(report, resolveStyle(caps({}, false)));
    expect(output).toContain('→ Fix it.');
  });
});

describe('renderJson', () => {
  const report = sampleReport();

  it('round-trips through JSON.parse with the declared envelope', () => {
    const text = renderJson(report);
    expect(text.endsWith('\n')).toBe(true);

    const envelope = parseEnvelope(text);

    expect(Object.keys(envelope)).toEqual([
      'schemaVersion',
      'tool',
      'version',
      'command',
      'generatedAt',
      'status',
      'summary',
      'sections',
    ]);
    expect(envelope['schemaVersion']).toBe(JSON_SCHEMA_VERSION);
    expect(envelope['tool']).toBe('sablectl');
    expect(stringAt(envelope, 'version')).toBe(report.version);
    expect(stringAt(envelope, 'command')).toBe(report.command);
    expect(stringAt(envelope, 'generatedAt')).toBe(report.generatedAt);
    expect(stringAt(envelope, 'status')).toBe(worstStatus(report));
    expect(recordAt(envelope, 'summary')).toEqual({
      pass: 1,
      warn: 1,
      fail: 1,
      info: 1,
      skip: 1,
    });
  });

  it('mirrors the sections and results of the report', () => {
    const envelope = parseEnvelope(renderJson(report));
    const sections = recordsAt(envelope, 'sections');

    expect(sections).toHaveLength(report.sections.length);
    expect(sections.map((section) => stringAt(section, 'title'))).toEqual(
      report.sections.map((section) => section.title),
    );

    const results = recordsAt(sections[0] ?? {}, 'results');
    expect(results.map((result) => stringAt(result, 'status'))).toEqual([
      'fail',
      'warn',
      'pass',
      'info',
      'skip',
    ]);
    expect(recordsAt(sections[1] ?? {}, 'results')).toEqual([]);
  });

  it('omits remediation and detail when the check has none', () => {
    const envelope = parseEnvelope(renderJson(report));
    const results = recordsAt(
      recordsAt(envelope, 'sections')[0] ?? {},
      'results',
    );

    const failing = results[0] ?? {};
    expect(Object.keys(failing)).toEqual([
      'id',
      'title',
      'status',
      'summary',
      'remediation',
      'detail',
    ]);

    const passing = results[2] ?? {};
    expect(Object.keys(passing)).toEqual(['id', 'title', 'status', 'summary']);
  });

  it('never contains an escape sequence, whatever the terminal', () => {
    expect(renderJson(report)).not.toContain(ESC);
  });

  it('agrees with the human renderer on every status word', () => {
    const human = renderHuman(report, resolveStyle(caps({}, false)));
    const json = renderJson(report);

    for (const status of ALL_STATUSES) {
      expect(human).toContain(STATUS_LABEL[status]);
      expect(json).toContain(`"status": "${status}"`);
    }
  });

  it('is stable across repeated renders of the same report', () => {
    expect(renderJson(report)).toBe(renderJson(sampleReport()));
  });
});
