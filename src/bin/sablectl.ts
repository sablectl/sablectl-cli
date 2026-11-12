#!/usr/bin/env node
/**
 * Entry point. Deliberately thin: it owns the process, and nothing else.
 *
 * All behaviour lives in `run`, which is a function of its arguments and an
 * injected system, so the tests exercise the same code path a user does
 * without needing to spawn a process for every case.
 */
import { run } from '../cli.js';
import { EXIT } from '../core/errors.js';

const exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).catch((error: unknown) => {
  // `run` maps its own errors; reaching here means the mapping itself
  // failed, which is a defect rather than a user-facing condition.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sablectl: internal error: ${message}\n`);
  return EXIT.INTERNAL;
});

process.exitCode = exitCode;
