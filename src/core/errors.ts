/**
 * Process exit codes, documented in `--help` and in the README because
 * callers in CI depend on them. They are part of the public interface and
 * changing one is a breaking change.
 */
export const EXIT = {
  /** Success: the command ran and every check passed. */
  SUCCESS: 0,
  /** Checks failed, or the command cannot complete in this context. */
  FAILURE: 1,
  /** Usage error: unknown command, unknown flag, invalid argument. */
  USAGE: 2,
  /** Unexpected internal error. */
  INTERNAL: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * A usage mistake made by the caller. Carries an optional hint so the
 * message can suggest the correction rather than only naming the problem.
 */
export class UsageError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UsageError';
    this.hint = hint;
  }
}

/**
 * The command was understood but cannot produce a result here — for example
 * `git` run outside a repository. This is a normal outcome reported plainly,
 * not a crash, and never prints a stack trace.
 */
export class CommandFailure extends Error {
  readonly remediation: string | undefined;

  constructor(message: string, remediation?: string) {
    super(message);
    this.name = 'CommandFailure';
    this.remediation = remediation;
  }
}
