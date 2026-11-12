import { execFile } from 'node:child_process';
import type { ExecOptions, ExecResult } from './types.js';

/**
 * Subprocess execution, with the shell deliberately absent.
 *
 * `execFile` with an argument array passes arguments to the kernel directly.
 * Nothing derived from a branch name, a directory name or a remote URL is
 * ever parsed by a shell, so a branch called `; rm -rf ~` is just an
 * unusually-named branch rather than a vulnerability. This is a structural
 * property, not a filter that must anticipate every metacharacter.
 *
 * Three further bounds, each closing a denial-of-service path:
 *
 * - a timeout, so a hung `git` cannot hang the CLI;
 * - an output cap, so a repository with pathological output cannot exhaust
 *   memory;
 * - no inherited stdin, so a subprocess cannot block waiting for input (a
 *   credential prompt from `git`, most plausibly).
 */
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export async function runCommand(
  file: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<ExecResult>((resolve) => {
    execFile(
      file,
      [...args],
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        timeout,
        maxBuffer,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        // A subprocess must never inherit the terminal's locale-dependent
        // formatting: `git` output is parsed, and a translated message or a
        // localised date would silently change the parse.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
        },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ran: true, code: 0, stdout, stderr });
          return;
        }

        const code =
          typeof error.code === 'number'
            ? error.code
            : typeof error.code === 'string'
              ? null
              : null;

        // `ENOENT` means the executable is absent — a normal finding for
        // `pnpm` or even `git`, reported as a failed check rather than a
        // crash.
        const missing = error.code === 'ENOENT';
        const timedOut =
          error.killed === true ||
          (error.signal !== null && error.signal !== undefined);
        const truncated = error.message.includes('maxBuffer');

        resolve({
          ran: !missing,
          code,
          stdout,
          stderr,
          ...(missing
            ? { error: `executable not found: ${file}` }
            : timedOut
              ? { error: `timed out after ${timeout} ms` }
              : truncated
                ? { error: `output exceeded ${maxBuffer} bytes` }
                : { error: error.message }),
          ...(truncated ? { truncated: true } : {}),
        });
      },
    );
  });
}
