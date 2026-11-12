import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GLOBAL_FLAGS } from '../../../src/core/args.js';
import { EXIT } from '../../../src/core/errors.js';
import {
  renderCommandHelp,
  renderRootHelp,
  renderVersion,
} from '../../../src/core/help.js';
import {
  COMMANDS,
  commandNames,
  findCommand,
} from '../../../src/core/registry.js';
import { PRODUCT_NAME, VERSION } from '../../../src/core/version.js';
import { isRecord } from '../../helpers/json.js';

/**
 * The version is read from the manifest a second time, independently of the
 * source under test: a hardcoded literal in `version.ts` would pass a test
 * that compared it against itself.
 */
function manifestVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(
    join(here, '..', '..', '..', 'package.json'),
    'utf8',
  );
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || typeof parsed['version'] !== 'string') {
    throw new Error('package.json has no string version');
  }
  return parsed['version'];
}

describe('COMMANDS', () => {
  it('declares a unique, non-empty name for every command', () => {
    const names = commandNames();
    expect(names.length).toBe(COMMANDS.length);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('describes every command well enough to document it', () => {
    for (const command of COMMANDS) {
      expect(command.summary).not.toBe('');
      expect(command.summary.endsWith('.')).toBe(true);
      expect(command.usage.startsWith(`sablectl ${command.name}`)).toBe(true);
      expect(command.description.length).toBeGreaterThan(0);
      for (const flag of command.flags) {
        expect(flag.description).not.toBe('');
        if (flag.type === 'string') {
          expect(flag.value).toBeDefined();
        }
      }
    }
  });

  it('declares no command flag that collides with a global flag', () => {
    const globals = new Set(GLOBAL_FLAGS.map((flag) => flag.name));
    for (const command of COMMANDS) {
      for (const flag of command.flags) {
        if (globals.has(flag.name)) {
          // A command may re-declare a global only if the spec is identical.
          const global = GLOBAL_FLAGS.find(
            (candidate) => candidate.name === flag.name,
          );
          expect(flag.type).toBe(global?.type);
        }
      }
    }
  });

  it('finds every registered command by name and nothing else', () => {
    for (const command of COMMANDS) {
      expect(findCommand(command.name)).toBe(command);
    }
    expect(findCommand('nope')).toBeUndefined();
    expect(findCommand('')).toBeUndefined();
    expect(findCommand('DOCTOR')).toBeUndefined();
  });
});

describe('renderRootHelp', () => {
  const help = renderRootHelp();

  it('lists exactly the commands in the registry, with their summaries', () => {
    const listed = help
      .split('\n')
      .slice(
        help.split('\n').indexOf('Commands:') + 1,
        help.split('\n').indexOf('Global options:') - 1,
      )
      .filter((line) => line.trim() !== '')
      .map((line) => line.trim().split(/\s{2,}/)[0]);

    expect(listed).toEqual(commandNames());

    for (const command of COMMANDS) {
      expect(help).toContain(command.summary);
    }
  });

  it('documents every global flag', () => {
    for (const flag of GLOBAL_FLAGS) {
      expect(help).toContain(`--${flag.name}`);
      expect(help).toContain(flag.description);
      if (flag.short !== undefined) {
        expect(help).toContain(`-${flag.short}, --${flag.name}`);
      }
    }
  });

  it('documents every exit code the tool can return', () => {
    for (const code of Object.values(EXIT)) {
      expect(help).toContain(`  ${String(code)}  `);
    }
  });

  it('names the product', () => {
    expect(help).toContain('Sable Developer Toolkit');
    expect(PRODUCT_NAME).toBe('sablectl');
  });
});

describe('renderCommandHelp', () => {
  it('documents each command from its own declaration', () => {
    for (const command of COMMANDS) {
      const help = renderCommandHelp(command);

      expect(help).toContain(`sablectl ${command.name} — ${command.summary}`);
      expect(help).toContain(`Usage: ${command.usage}`);
      for (const line of command.description) {
        expect(help).toContain(line);
      }
      for (const flag of command.flags) {
        expect(help).toContain(`--${flag.name}`);
        expect(help).toContain(flag.description);
      }
      expect(help).toContain('Global options:');
    }
  });

  it('omits the Options heading for a command with no flags', () => {
    const withoutFlags = COMMANDS.filter(
      (command) => command.flags.length === 0,
    );
    expect(withoutFlags.length).toBeGreaterThan(0);
    for (const command of withoutFlags) {
      expect(renderCommandHelp(command)).not.toContain('Options:\n  --');
    }
  });
});

describe('renderVersion', () => {
  it('prints the version read from the manifest, not a literal', () => {
    const expected = manifestVersion();
    expect(VERSION).toBe(expected);
    expect(renderVersion()).toBe(`sablectl v${expected}\n`);
  });
});
