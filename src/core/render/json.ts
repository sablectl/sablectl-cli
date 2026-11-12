import { type Report, tally, worstStatus } from '../check.js';

/**
 * The JSON envelope is a published interface: CI pipelines parse it. It is
 * versioned independently of the tool so a consumer can detect a breaking
 * change without string-matching on the tool version.
 */
export const JSON_SCHEMA_VERSION = 1;

/**
 * Rendered with a stable key order and two-space indentation. Stability is
 * deliberate: diffing two runs of `--json` should show what changed in the
 * system, not what changed in the serialiser.
 */
export function renderJson(report: Report): string {
  const counts = tally(report);

  const envelope = {
    schemaVersion: JSON_SCHEMA_VERSION,
    tool: 'sablectl',
    version: report.version,
    command: report.command,
    generatedAt: report.generatedAt,
    status: worstStatus(report),
    summary: {
      pass: counts.pass,
      warn: counts.warn,
      fail: counts.fail,
      info: counts.info,
      skip: counts.skip,
    },
    sections: report.sections.map((section) => ({
      title: section.title,
      results: section.results.map((result) => ({
        id: result.id,
        title: result.title,
        status: result.status,
        summary: result.summary,
        ...(result.remediation === undefined
          ? {}
          : { remediation: result.remediation }),
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      })),
    })),
  };

  return `${JSON.stringify(envelope, null, 2)}\n`;
}
