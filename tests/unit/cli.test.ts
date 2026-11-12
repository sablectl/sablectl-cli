import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { EXIT } from '../../src/core/errors.js';
import { commandNames } from '../../src/core/registry.js';
import { VERSION } from '../../src/core/version.js';
import type { SystemAccess } from '../../src/platform/types.js';
import { captureIo, createFakeSystem } from '../helpers/fake-system.js';
import { parseEnvelope, statusesById, stringAt } from '../helpers/json.js';

const ESC = '\u001B';

function project() {
  return createFakeSystem({
    nodeVersion: '22.11.0',
    files: {
      '/project/package.json': JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        engines: { node: '>=20.19' },
        files: ['dist'],
      }),
      '/project/package-lock.json': '{}',
      '/project/tsconfig.json': '{"compilerOptions":{"strict":true}}',
    },
  });
}

describe('run', () => {
  it('prints the root help and exits 0 for no arguments', async () => {
    const io = captureIo();
    expect(await run([], io, project())).toBe(EXIT.SUCCESS);
    expect(io.out()).toContain('Usage: sablectl <command> [options]');
    expect(io.err()).toBe('');
  });

  it('prints the root help for --help and for help', async () => {
    const flagIo = captureIo();
    const wordIo = captureIo();

    expect(await run(['--help'], flagIo, project())).toBe(EXIT.SUCCESS);
    expect(await run(['help'], wordIo, project())).toBe(EXIT.SUCCESS);
    expect(flagIo.out()).toBe(wordIo.out());
  });

  it('gives identical text for "help <command>" and "<command> --help"', async () => {
    for (const name of commandNames()) {
      const first = captureIo();
      const second = captureIo();

      expect(await run(['help', name], first, project())).toBe(EXIT.SUCCESS);
      expect(await run([name, '--help'], second, project())).toBe(EXIT.SUCCESS);

      expect(first.out()).toBe(second.out());
      expect(first.out()).toContain(`sablectl ${name}`);
    }
  });

  it('prints the version read from the manifest', async () => {
    const io = captureIo();
    expect(await run(['--version'], io, project())).toBe(EXIT.SUCCESS);
    expect(io.out()).toBe(`sablectl v${VERSION}\n`);
  });

  it('rejects an unknown command with exit 2 and a suggestion', async () => {
    const io = captureIo();
    expect(await run(['doctr'], io, project())).toBe(EXIT.USAGE);
    expect(io.err()).toContain("unknown command 'doctr'");
    expect(io.err()).toContain("Did you mean 'doctor'?");
    expect(io.out()).toBe('');
  });

  it('rejects an unknown command without inventing a suggestion', async () => {
    const io = captureIo();
    expect(await run(['photosynthesis'], io, project())).toBe(EXIT.USAGE);
    expect(io.err()).toContain("unknown command 'photosynthesis'");
    expect(io.err()).not.toContain('Did you mean');
  });

  it('rejects an unknown flag with exit 2', async () => {
    const io = captureIo();
    expect(await run(['validate', '--nope'], io, project())).toBe(EXIT.USAGE);
    expect(io.err()).toContain("unknown option '--nope'");
  });

  it('rejects help for a command that does not exist', async () => {
    const io = captureIo();
    expect(await run(['help', 'nope'], io, project())).toBe(EXIT.USAGE);
    expect(io.err()).toContain("unknown command 'nope'");
  });

  it('exits 2 when --path escapes the working directory', async () => {
    const io = captureIo();
    expect(await run(['inspect', '--path', '../../etc'], io, project())).toBe(
      EXIT.USAGE,
    );
    expect(io.err()).toContain('must stay within the working directory');
    expect(io.err()).not.toMatch(/\n\s+at /);
  });

  it('exits 0 for a clean project and 1 when a check fails', async () => {
    const clean = captureIo();
    expect(await run(['validate'], clean, project())).toBe(EXIT.SUCCESS);

    const broken = createFakeSystem({
      nodeVersion: '22.11.0',
      files: { '/project/package.json': '{ oops' },
    });
    const io = captureIo();
    expect(await run(['validate'], io, broken)).toBe(EXIT.FAILURE);
    expect(io.out()).toContain('FAIL');
  });

  it('promotes a warning to a failure only under --strict', async () => {
    const system = createFakeSystem({
      nodeVersion: '22.11.0',
      files: {
        '/project/package.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          engines: { node: '>=20.19' },
          files: ['dist'],
        }),
      },
    });

    expect(await run(['validate'], captureIo(), system)).toBe(EXIT.SUCCESS);
    expect(await run(['validate', '--strict'], captureIo(), system)).toBe(
      EXIT.FAILURE,
    );
  });

  it('emits a parseable envelope for --json and nothing else', async () => {
    const io = captureIo();
    expect(await run(['validate', '--json'], io, project())).toBe(EXIT.SUCCESS);

    const envelope = parseEnvelope(io.out());
    expect(stringAt(envelope, 'command')).toBe('validate');
    expect(stringAt(envelope, 'tool')).toBe('sablectl');
    expect(statusesById(envelope).get('manifest.parses')).toBe('pass');
    expect(io.out()).not.toContain(ESC);
  });

  it('writes no colour when the terminal is not a TTY', async () => {
    const io = captureIo();
    await run(['validate'], io, project());
    expect(io.out()).not.toContain(ESC);
  });

  it('honours --no-color even on a colour-capable terminal', async () => {
    const coloured = createFakeSystem({
      nodeVersion: '22.11.0',
      terminal: { isTTY: true, columns: 100, env: {} },
      files: { '/project/package.json': '{"name":"d","version":"1.0.0"}' },
    });

    const withColor = captureIo();
    const withoutColor = captureIo();

    await run(['validate'], withColor, coloured);
    await run(['validate', '--no-color'], withoutColor, coloured);

    expect(withColor.out()).toContain(ESC);
    expect(withoutColor.out()).not.toContain(ESC);
  });

  it('includes check detail only with --verbose', async () => {
    const plain = captureIo();
    const verbose = captureIo();

    await run(['validate'], plain, project());
    await run(['validate', '--verbose'], verbose, project());

    expect(verbose.out().length).toBeGreaterThan(plain.out().length);
    expect(verbose.out()).toContain('path: package.json');
  });

  it('maps an unexpected internal error to exit 3 without a stack trace', async () => {
    const exploding = createFakeSystem({ nodeVersion: '22.11.0' });
    const broken: SystemAccess = {
      cwd: exploding.cwd,
      env: exploding.env,
      nodeVersion: exploding.nodeVersion,
      now: () => exploding.now(),
      osInfo: () => exploding.osInfo(),
      terminal: () => exploding.terminal(),
      exec: exploding.exec.bind(exploding),
      readTextFile: () => {
        throw new TypeError('reading went wrong');
      },
      statPath: exploding.statPath.bind(exploding),
      readDirectory: exploding.readDirectory.bind(exploding),
      walkDirectory: exploding.walkDirectory.bind(exploding),
    };

    const io = captureIo();
    expect(await run(['validate'], io, broken)).toBe(EXIT.INTERNAL);
    expect(io.err()).toContain('internal error: reading went wrong');
    expect(io.err()).not.toMatch(/\n\s+at /);
  });

  it('treats everything after -- as positional rather than as flags', async () => {
    const io = captureIo();
    expect(await run(['validate', '--', '--nope'], io, project())).toBe(
      EXIT.SUCCESS,
    );
    expect(io.err()).toBe('');
  });
});
