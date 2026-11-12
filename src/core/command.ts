import type { SystemAccess } from '../platform/types.js';
import type { FlagSpec, ParsedFlags } from './args.js';
import type { Report } from './check.js';
import type { OutputStyle } from './render/style.js';

export interface CommandContext {
  /** The resolved project root the command operates on. */
  readonly cwd: string;
  readonly system: SystemAccess;
  readonly output: OutputStyle;
  readonly flags: ParsedFlags;
  readonly positionals: readonly string[];
}

/**
 * Commands are thin by design: each declares its flags, selects a set of
 * checks and returns a report. Rendering and exit-code derivation happen
 * outside, so a command cannot accidentally invent its own convention for
 * either.
 */
export interface CommandDefinition {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly description: readonly string[];
  readonly flags: readonly FlagSpec[];
  run(ctx: CommandContext): Promise<Report>;
}
