/**
 * Programmatic entry point.
 *
 * The check model and renderers are exported so the reports can be consumed
 * in a script without parsing the terminal output, which is the same reason
 * `--json` exists.
 */
export { run, type CliIo } from './cli.js';
export {
  bySeverityThenId,
  compareSeverity,
  exitCodeFor,
  tally,
  worstStatus,
  type CheckResult,
  type CheckStatus,
  type Report,
  type ReportSection,
} from './core/check.js';
export {
  EXIT,
  CommandFailure,
  UsageError,
  type ExitCode,
} from './core/errors.js';
export { redactCredentials } from './core/redact.js';
export { renderHuman } from './core/render/human.js';
export { renderJson, JSON_SCHEMA_VERSION } from './core/render/json.js';
export { resolveStyle, type OutputStyle } from './core/render/style.js';
export { COMMANDS, commandNames, findCommand } from './core/registry.js';
export { VERSION, PRODUCT_NAME, PRODUCT_SUBTITLE } from './core/version.js';
export type { CommandContext, CommandDefinition } from './core/command.js';
export { NodeSystem } from './platform/system.js';
export type { SystemAccess } from './platform/types.js';
