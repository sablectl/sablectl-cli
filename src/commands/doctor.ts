import { option, type FlagSpec } from '../core/args.js';
import { bySeverityThenId } from '../core/check.js';
import type { CommandContext, CommandDefinition } from '../core/command.js';
import { resolveProjectPath } from '../core/project.js';
import { VERSION } from '../core/version.js';
import { collectEnvChecks } from './env.js';
import { collectGitChecks } from './git.js';
import { collectInspectChecks } from './inspect.js';
import { collectValidateChecks } from './validate.js';

export const doctorFlags: readonly FlagSpec[] = [
  {
    name: 'path',
    type: 'string',
    value: '<dir>',
    description:
      'Project directory to diagnose. Must be inside the working directory.',
  },
  {
    name: 'strict',
    type: 'boolean',
    description: 'Treat warnings as failures (exit 1 instead of 0).',
  },
];

/**
 * `doctor` is the union of the other commands' checks, ordered worst-first.
 *
 * It owns no checks of its own, which is the point of the check
 * abstraction: a new check added to `validate` appears in `doctor`
 * automatically, and cannot be reported differently by the two.
 */
export const doctorCommand: CommandDefinition = {
  name: 'doctor',
  summary: 'Developer environment diagnostics.',
  usage: 'sablectl doctor [--path <dir>] [--strict] [options]',
  description: [
    'Runs the environment, Git, project and validation checks together and',
    'presents each section ordered by severity, so the things that need',
    'attention appear first. Exits 1 if any check failed.',
  ],
  flags: doctorFlags,
  async run(ctx: CommandContext) {
    const root = resolveProjectPath(ctx.cwd, option(ctx.flags, 'path'));

    // Independent of one another, so they are gathered concurrently; the
    // command is expected to answer in well under a second.
    const [environment, git, project, validation] = await Promise.all([
      collectEnvChecks(ctx.system),
      collectGitChecks(ctx.system, root),
      collectInspectChecks(ctx.system, root),
      collectValidateChecks(ctx.system, root),
    ]);

    return {
      command: 'doctor',
      version: VERSION,
      generatedAt: ctx.system.now().toISOString(),
      sections: [
        { title: 'Environment', results: bySeverityThenId(environment) },
        { title: 'Git', results: bySeverityThenId(git) },
        { title: 'Project', results: bySeverityThenId(project) },
        { title: 'Validation', results: bySeverityThenId(validation) },
      ],
    };
  },
};
