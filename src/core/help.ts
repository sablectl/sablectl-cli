import { GLOBAL_FLAGS, type FlagSpec } from './args.js';
import { EXIT } from './errors.js';
import type { CommandDefinition } from './command.js';
import { COMMANDS } from './registry.js';
import { PRODUCT_SUBTITLE, PRODUCT_TAGLINE, VERSION } from './version.js';

/**
 * Help is generated from the registry rather than written out by hand, so a
 * command added without documentation is impossible: the list is the
 * documentation.
 */
export function renderRootHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));

  const lines = [
    PRODUCT_SUBTITLE,
    PRODUCT_TAGLINE,
    '',
    'Usage: sablectl <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map(
      (command) => `  ${command.name.padEnd(width)}  ${command.summary}`,
    ),
    '',
    'Global options:',
    ...formatFlags(GLOBAL_FLAGS),
    '',
    'Exit codes:',
    `  ${EXIT.SUCCESS}  success; all checks passed`,
    `  ${EXIT.FAILURE}  one or more checks failed, or the command cannot run here`,
    `  ${EXIT.USAGE}  usage error: unknown command, unknown flag, bad argument`,
    `  ${EXIT.INTERNAL}  unexpected internal error`,
    '',
    "Run 'sablectl help <command>' for detail on a single command.",
    '',
  ];

  return lines.join('\n');
}

export function renderCommandHelp(command: CommandDefinition): string {
  const lines = [
    `sablectl ${command.name} — ${command.summary}`,
    '',
    `Usage: ${command.usage}`,
    '',
    ...command.description,
    '',
  ];

  if (command.flags.length > 0) {
    lines.push('Options:', ...formatFlags(command.flags), '');
  }

  lines.push('Global options:', ...formatFlags(GLOBAL_FLAGS), '');

  return lines.join('\n');
}

export function renderVersion(): string {
  return `sablectl v${VERSION}\n`;
}

function formatFlags(flags: readonly FlagSpec[]): string[] {
  const rendered = flags.map((spec) => ({
    left:
      (spec.short === undefined ? '    ' : `-${spec.short}, `) +
      `--${spec.name}` +
      (spec.type === 'string' ? ` ${spec.value ?? '<value>'}` : ''),
    description: spec.description,
  }));

  const width = Math.max(...rendered.map((entry) => entry.left.length));
  return rendered.map(
    (entry) => `  ${entry.left.padEnd(width)}  ${entry.description}`,
  );
}
