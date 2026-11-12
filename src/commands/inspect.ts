import { join } from 'node:path';
import { option, type FlagSpec } from '../core/args.js';
import type { CheckResult } from '../core/check.js';
import type { CommandContext, CommandDefinition } from '../core/command.js';
import { resolveProjectPath } from '../core/project.js';
import { VERSION } from '../core/version.js';
import { isIgnored, parseGitignore } from '../parse/gitignore.js';
import {
  detectFromLockfiles,
  LOCKFILES,
  managerFromField,
} from '../parse/lockfile.js';
import { parseManifest, type Manifest } from '../parse/manifest.js';
import { parseTsConfig } from '../parse/tsconfig.js';
import type { SystemAccess } from '../platform/types.js';

/**
 * Traversal bounds. `inspect` summarises a project; it does not index one.
 * Bounding by depth and entry count keeps the command inside its
 * sub-second budget on a large monorepo and guarantees termination on a
 * pathological tree.
 */
const MAX_DEPTH = 3;
const MAX_ENTRIES = 2_000;
const ALWAYS_SKIP = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.svelte-kit',
  'coverage',
  'target',
  'vendor',
];

const TEST_FRAMEWORKS: readonly {
  readonly name: string;
  readonly packages: readonly string[];
}[] = [
  { name: 'Vitest', packages: ['vitest'] },
  { name: 'Jest', packages: ['jest', 'ts-jest'] },
  { name: 'Mocha', packages: ['mocha'] },
  { name: 'AVA', packages: ['ava'] },
  { name: 'Playwright', packages: ['@playwright/test', 'playwright'] },
  { name: 'Cypress', packages: ['cypress'] },
  { name: 'node:test', packages: [] },
];

export const inspectFlags: readonly FlagSpec[] = [
  {
    name: 'path',
    type: 'string',
    value: '<dir>',
    description:
      'Project directory to inspect. Must be inside the working directory.',
  },
];

export async function collectInspectChecks(
  system: SystemAccess,
  root: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const topLevel = await system.readDirectory(root);
  const names = topLevel.map((entry) => entry.name);

  const manifestRead = await system.readTextFile(join(root, 'package.json'));
  let manifest: Manifest | undefined;

  if (manifestRead.ok) {
    const parsedManifest = parseManifest('package.json', manifestRead.content);
    if (parsedManifest.ok) {
      manifest = parsedManifest.value;
    } else {
      results.push({
        id: 'project.manifest',
        title: 'Manifest',
        status: 'fail',
        summary: `package.json could not be parsed: ${parsedManifest.error.reason}`,
        detail: { path: parsedManifest.error.path },
        remediation: 'Fix the JSON syntax in package.json.',
      });
    }
  }

  results.push(projectTypeCheck(names, manifest));
  results.push(packageManagerCheck(names, manifest));

  if (manifest !== undefined) {
    results.push(scriptsCheck(manifest));
    results.push(dependencyCountCheck(manifest));
    results.push(workspacesCheck(manifest));
    results.push(testFrameworkCheck(manifest, names));
  }

  results.push(await tsConfigCheck(system, root, names));
  results.push(await directorySummaryCheck(system, root));

  return results;
}

function projectTypeCheck(
  names: readonly string[],
  manifest: Manifest | undefined,
): CheckResult {
  const markers: string[] = [];
  if (manifest !== undefined) markers.push('Node.js package');
  if (names.includes('tsconfig.json')) markers.push('TypeScript');
  if (names.includes('deno.json') || names.includes('deno.jsonc')) {
    markers.push('Deno');
  }
  if (names.includes('Cargo.toml')) markers.push('Rust');
  if (names.includes('go.mod')) markers.push('Go');
  if (names.includes('pyproject.toml') || names.includes('setup.py')) {
    markers.push('Python');
  }
  if (names.includes('Dockerfile')) markers.push('Docker');

  if (markers.length === 0) {
    return {
      id: 'project.type',
      title: 'Project type',
      status: 'warn',
      summary: 'no recognised project manifest in this directory',
      detail: { markers: [] },
      remediation:
        'Run inspect from the project root, where the manifest lives.',
    };
  }

  return {
    id: 'project.type',
    title: 'Project type',
    status: 'info',
    summary: markers.join(', '),
    detail: { markers },
  };
}

function packageManagerCheck(
  names: readonly string[],
  manifest: Manifest | undefined,
): CheckResult {
  const detection = detectFromLockfiles(names);
  const declared = managerFromField(manifest?.packageManager);

  if (detection.managers.length === 0) {
    return {
      id: 'project.packageManager',
      title: 'Package manager',
      status: declared === undefined ? 'warn' : 'info',
      summary:
        declared === undefined
          ? 'no lockfile found, so the package manager cannot be determined'
          : `no lockfile, but packageManager declares ${declared}`,
      detail: { lockfiles: [], declared: declared ?? null },
      ...(declared === undefined
        ? {
            remediation: `Commit a lockfile (${LOCKFILES.map(
              (entry) => entry.file,
            )
              .slice(0, 3)
              .join(', ')}, …) so installs are reproducible.`,
          }
        : {}),
    };
  }

  if (detection.managers.length > 1) {
    return {
      id: 'project.packageManager',
      title: 'Package manager',
      status: 'warn',
      summary: `several lockfiles present: ${detection.files.join(', ')}`,
      detail: {
        lockfiles: detection.files,
        managers: detection.managers,
        declared: declared ?? null,
      },
      remediation:
        'Keep one lockfile. Two package managers will install different trees.',
    };
  }

  const detected = detection.managers[0];
  const mismatch = declared !== undefined && declared !== detected;

  return {
    id: 'project.packageManager',
    title: 'Package manager',
    status: mismatch ? 'warn' : 'info',
    summary: mismatch
      ? `${detected ?? 'unknown'} by lockfile, but packageManager declares ${declared}`
      : `${detected ?? 'unknown'} (${detection.files.join(', ')})`,
    detail: {
      detected: detected ?? null,
      declared: declared ?? null,
      lockfiles: detection.files,
    },
    ...(mismatch
      ? {
          remediation:
            'Align the packageManager field with the lockfile actually committed.',
        }
      : {}),
  };
}

function scriptsCheck(manifest: Manifest): CheckResult {
  const names = Object.keys(manifest.scripts).sort();
  return {
    id: 'project.scripts',
    title: 'Scripts',
    status: 'info',
    summary:
      names.length === 0
        ? 'none declared'
        : `${names.length}: ${names.join(', ')}`,
    detail: { scripts: names },
  };
}

function dependencyCountCheck(manifest: Manifest): CheckResult {
  const runtime = Object.keys(manifest.dependencies).length;
  const development = Object.keys(manifest.devDependencies).length;
  const peer = Object.keys(manifest.peerDependencies).length;

  return {
    id: 'project.dependencies',
    title: 'Dependencies',
    status: 'info',
    summary: `${runtime} runtime, ${development} development, ${peer} peer`,
    detail: { runtime, development, peer },
  };
}

function workspacesCheck(manifest: Manifest): CheckResult {
  return {
    id: 'project.workspaces',
    title: 'Workspaces',
    status: 'info',
    summary:
      manifest.workspaces.length === 0
        ? 'single package'
        : `${manifest.workspaces.length} pattern(s): ${manifest.workspaces.join(', ')}`,
    detail: { workspaces: manifest.workspaces },
  };
}

function testFrameworkCheck(
  manifest: Manifest,
  names: readonly string[],
): CheckResult {
  const declared = new Set([
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies),
  ]);

  const found = TEST_FRAMEWORKS.filter((framework) =>
    framework.packages.some((name) => declared.has(name)),
  ).map((framework) => framework.name);

  // `node:test` leaves no dependency, so it is inferred from the test script.
  const testScript = manifest.scripts['test'] ?? '';
  if (/node\s+--test|node:test/.test(testScript)) found.push('node:test');

  if (found.length === 0) {
    const hasTestDirectory =
      names.includes('test') ||
      names.includes('tests') ||
      names.includes('spec');
    return {
      id: 'project.tests',
      title: 'Test framework',
      status: hasTestDirectory ? 'warn' : 'info',
      summary: hasTestDirectory
        ? 'a test directory exists but no test framework is declared'
        : 'none detected',
      detail: { frameworks: [] },
      ...(hasTestDirectory
        ? { remediation: 'Declare the test runner as a devDependency.' }
        : {}),
    };
  }

  return {
    id: 'project.tests',
    title: 'Test framework',
    status: 'pass',
    summary: found.join(', '),
    detail: { frameworks: found },
  };
}

async function tsConfigCheck(
  system: SystemAccess,
  root: string,
  names: readonly string[],
): Promise<CheckResult> {
  if (!names.includes('tsconfig.json')) {
    return {
      id: 'project.typescript',
      title: 'TypeScript configuration',
      status: 'info',
      summary: 'no tsconfig.json in this directory',
      detail: { present: false },
    };
  }

  const read = await system.readTextFile(join(root, 'tsconfig.json'));
  if (!read.ok) {
    return {
      id: 'project.typescript',
      title: 'TypeScript configuration',
      status: 'fail',
      summary: `tsconfig.json could not be read: ${read.reason}`,
      detail: { present: true },
      remediation: 'Check the file permissions and size.',
    };
  }

  const config = parseTsConfig('tsconfig.json', read.content);
  if (!config.ok) {
    return {
      id: 'project.typescript',
      title: 'TypeScript configuration',
      status: 'fail',
      summary: `tsconfig.json could not be parsed: ${config.error.reason}`,
      detail: { present: true },
      remediation: 'Fix the JSON syntax in tsconfig.json.',
    };
  }

  const { strict, target, module, extends: inherits } = config.value;

  if (strict === undefined) {
    return {
      id: 'project.typescript',
      title: 'TypeScript configuration',
      status: inherits === undefined ? 'warn' : 'info',
      summary:
        inherits === undefined
          ? 'strict is not set'
          : `strict is not set here; it may come from '${inherits}'`,
      detail: {
        present: true,
        strict: null,
        extends: inherits ?? null,
        target: target ?? null,
      },
      ...(inherits === undefined
        ? {
            remediation:
              'Enable "strict": true. Most of TypeScript\'s value is behind it.',
          }
        : {}),
    };
  }

  return {
    id: 'project.typescript',
    title: 'TypeScript configuration',
    status: strict ? 'pass' : 'warn',
    summary: strict
      ? `strict enabled, target ${target ?? 'default'}`
      : 'strict is explicitly disabled',
    detail: {
      present: true,
      strict,
      target: target ?? null,
      module: module ?? null,
      extends: inherits ?? null,
      strictFamily: config.value.strictFamily,
    },
    ...(strict
      ? {}
      : {
          remediation:
            'Enable "strict": true; without it most type errors go unreported.',
        }),
  };
}

async function directorySummaryCheck(
  system: SystemAccess,
  root: string,
): Promise<CheckResult> {
  const ignoreRead = await system.readTextFile(join(root, '.gitignore'));
  const rules = ignoreRead.ok ? parseGitignore(ignoreRead.content) : [];

  const walk = await system.walkDirectory(root, {
    maxDepth: MAX_DEPTH,
    maxEntries: MAX_ENTRIES,
    skipDirectories: ALWAYS_SKIP,
    isIgnored: (relativePath) => isIgnored(rules, relativePath, true),
  });

  const files = walk.entries.filter((entry) => entry.kind === 'file');
  const directories = walk.entries.filter(
    (entry) => entry.kind === 'directory',
  );
  const topLevelDirectories = directories
    .filter((entry) => entry.depth === 0)
    .map((entry) => entry.path);

  const totalBytes = files.reduce((sum, entry) => sum + entry.sizeBytes, 0);

  return {
    id: 'project.layout',
    title: 'Directory summary',
    status: 'info',
    summary:
      `${files.length} files in ${directories.length} directories` +
      (walk.truncated ? ' (truncated at the traversal bound)' : '') +
      (walk.symlinksSkipped > 0
        ? `, ${walk.symlinksSkipped} symlink(s) not followed`
        : ''),
    detail: {
      files: files.length,
      directories: directories.length,
      totalBytes,
      truncated: walk.truncated,
      symlinksSkipped: walk.symlinksSkipped,
      topLevelDirectories,
      maxDepth: MAX_DEPTH,
      maxEntries: MAX_ENTRIES,
    },
  };
}

export const inspectCommand: CommandDefinition = {
  name: 'inspect',
  summary: 'Project structure inspection.',
  usage: 'sablectl inspect [--path <dir>] [options]',
  description: [
    'Describes the project in the working directory: detected type, package',
    'manager inferred from the lockfile, workspaces, declared scripts,',
    'dependency counts, TypeScript configuration, test framework, and a',
    'bounded directory summary that honours .gitignore and never follows',
    'symlinks.',
  ],
  flags: inspectFlags,
  async run(ctx: CommandContext) {
    const root = resolveProjectPath(ctx.cwd, option(ctx.flags, 'path'));
    const results = await collectInspectChecks(ctx.system, root);
    return {
      command: 'inspect',
      version: VERSION,
      generatedAt: ctx.system.now().toISOString(),
      sections: [{ title: 'Project', results }],
    };
  },
};
