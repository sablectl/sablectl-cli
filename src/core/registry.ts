import { doctorCommand } from '../commands/doctor.js';
import { envCommand } from '../commands/env.js';
import { gitCommand } from '../commands/git.js';
import { inspectCommand } from '../commands/inspect.js';
import { validateCommand } from '../commands/validate.js';
import type { CommandDefinition } from './command.js';

/**
 * The single command table. Help, dispatch and the tests all read it, so a
 * command cannot exist without being documented, and documentation cannot
 * describe a command that does not exist.
 */
export const COMMANDS: readonly CommandDefinition[] = [
  doctorCommand,
  envCommand,
  gitCommand,
  inspectCommand,
  validateCommand,
];

export function findCommand(name: string): CommandDefinition | undefined {
  return COMMANDS.find((command) => command.name === name);
}

export function commandNames(): string[] {
  return COMMANDS.map((command) => command.name);
}
