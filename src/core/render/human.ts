import { type CheckStatus, type Report, tally } from '../check.js';
import { paint, statusLabel, type OutputStyle } from './style.js';

/**
 * Human-readable rendering: a pure function of `(Report, OutputStyle)`.
 *
 * Purity matters here. Both renderers are tested against identical report
 * fixtures, so the text and JSON views cannot drift apart, and a renderer
 * bug cannot be hidden by whatever the live system happened to return.
 */
export function renderHuman(report: Report, style: OutputStyle): string {
  const lines: string[] = [];

  lines.push(
    paint(style, 'bold', `sablectl ${report.command}`) +
      paint(style, 'dim', `  v${report.version}`),
  );

  for (const section of report.sections) {
    lines.push('');
    lines.push(paint(style, 'bold', section.title));

    if (section.results.length === 0) {
      lines.push('  (nothing to report)');
      continue;
    }

    for (const result of section.results) {
      lines.push(`  ${statusLabel(style, result.status)}  ${result.title}`);
      lines.push(`        ${result.summary}`);

      if (result.remediation !== undefined && result.remediation !== '') {
        lines.push(`        ${paint(style, 'dim', `→ ${result.remediation}`)}`);
      }

      if (style.verbose && result.detail !== undefined) {
        for (const line of renderDetail(result.detail)) {
          lines.push(`        ${paint(style, 'dim', line)}`);
        }
      }
    }
  }

  lines.push('');
  lines.push(summaryLine(report, style));
  lines.push('');

  return lines.join('\n');
}

function summaryLine(report: Report, style: OutputStyle): string {
  const counts = tally(report);
  const order: readonly CheckStatus[] = [
    'fail',
    'warn',
    'pass',
    'info',
    'skip',
  ];
  const parts = order
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${status}`);

  const body = parts.length === 0 ? 'no checks ran' : parts.join(', ');
  return paint(style, 'dim', `${body}.`);
}

/**
 * Detail payloads are arbitrary JSON-shaped values, flattened to `key: value`
 * lines. Depth is bounded so a deeply nested payload cannot produce an
 * unreadable wall of text.
 */
function renderDetail(detail: Readonly<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    lines.push(`${key}: ${formatValue(value, 0)}`);
  }
  return lines;
}

function formatValue(value: unknown, depth: number): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (depth >= 2) return '…';
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatValue(item, depth + 1)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, nested]) => `${key}=${formatValue(nested, depth + 1)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return '…';
}
