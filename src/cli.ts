import { closestMatch, flag, parseArgs } from './core/args.js';
import { exitCodeFor } from './core/check.js';
import {
  CommandFailure,
  EXIT,
  UsageError,
  type ExitCode,
} from './core/errors.js';
import {
  renderCommandHelp,
  renderRootHelp,
  renderVersion,
} from './core/help.js';
import { renderHuman } from './core/render/human.js';
import { renderJson } from './core/render/json.js';
import { resolveStyle } from './core/render/style.js';
import { commandNames, findCommand } from './core/registry.js';
import { NodeSystem } from './platform/system.js';
import type { SystemAccess } from './platform/types.js';

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/**
 * The whole CLI as one function of its inputs, so the binary is a shell
 * around it and tests can drive it directly without spawning a process.
 */
export async function run(
  argv: readonly string[],
  io: CliIo,
  system: SystemAccess = new NodeSystem(),
): Promise<ExitCode> {
  try {
    const parsedArguments = parseArgs(argv, (name) => findCommand(name)?.flags);

    const { command: requested, positionals, flags } = parsedArguments;

    // `help <command>` is the same request as `<command> --help`, handled
    // in one place so the two cannot produce different text.
    const helpTarget =
      requested === 'help'
        ? positionals[0]
        : flag(flags, 'help')
          ? requested
          : undefined;

    if (requested === 'help' || flag(flags, 'help')) {
      if (helpTarget === undefined) {
        io.stdout(renderRootHelp());
        return EXIT.SUCCESS;
      }
      const command = findCommand(helpTarget);
      if (command === undefined) {
        return unknownCommand(helpTarget, io);
      }
      io.stdout(renderCommandHelp(command));
      return EXIT.SUCCESS;
    }

    if (flag(flags, 'version')) {
      io.stdout(renderVersion());
      return EXIT.SUCCESS;
    }

    if (requested === undefined) {
      io.stdout(renderRootHelp());
      return EXIT.SUCCESS;
    }

    const command = findCommand(requested);
    if (command === undefined) {
      return unknownCommand(requested, io);
    }

    const style = resolveStyle(system.terminal(), {
      noColor: flag(flags, 'no-color'),
      verbose: flag(flags, 'verbose'),
    });

    const report = await command.run({
      cwd: system.cwd,
      system,
      output: style,
      flags,
      positionals,
    });

    io.stdout(
      flag(flags, 'json') ? renderJson(report) : renderHuman(report, style),
    );

    return exitCodeFor(report, flag(flags, 'strict'));
  } catch (error: unknown) {
    return reportError(error, io);
  }
}

function unknownCommand(name: string, io: CliIo): ExitCode {
  const suggestion = closestMatch(name, [...commandNames(), 'help']);
  io.stderr(
    `sablectl: unknown command '${name}'` +
      (suggestion === undefined ? '' : `. Did you mean '${suggestion}'?`) +
      "\nRun 'sablectl --help' for the command list.\n",
  );
  return EXIT.USAGE;
}

/**
 * Errors are mapped to exit codes here and nowhere else. A stack trace is
 * never printed for an expected condition: "not a Git repository" is an
 * answer, not a crash, and presenting it as one trains people to ignore
 * real crashes.
 */
function reportError(error: unknown, io: CliIo): ExitCode {
  if (error instanceof UsageError) {
    io.stderr(
      `sablectl: ${error.message}` +
        (error.hint === undefined ? '' : `\n${error.hint}`) +
        '\n',
    );
    return EXIT.USAGE;
  }

  if (error instanceof CommandFailure) {
    io.stderr(
      `sablectl: ${error.message}` +
        (error.remediation === undefined ? '' : `\n${error.remediation}`) +
        '\n',
    );
    return EXIT.FAILURE;
  }

  const message = error instanceof Error ? error.message : String(error);
  io.stderr(
    `sablectl: internal error: ${message}\n` +
      'This is a defect. Please report it at ' +
      'https://github.com/sablectl/sablectl-cli/issues\n',
  );
  return EXIT.INTERNAL;
}
