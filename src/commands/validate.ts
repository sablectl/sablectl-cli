import { join } from 'node:path';
import { flag, option, type FlagSpec } from '../core/args.js';
import type { CheckResult } from '../core/check.js';
import type { CommandContext, CommandDefinition } from '../core/command.js';
import { resolveProjectPath } from '../core/project.js';
import { VERSION } from '../core/version.js';
import { detectFromLockfiles, managerFromField } from '../parse/lockfile.js';
import { parseManifest, type Manifest } from '../parse/manifest.js';
import { isValidSemVer, satisfiesRange } from '../parse/semver.js';
import { parseTsConfig } from '../parse/tsconfig.js';
import type { SystemAccess } from '../platform/types.js';

/**
 * Paths that must never be published. A package that ships its own `.env`
 * or private key publishes a credential to every consumer, permanently, and
 * the mistake is usually invisible until someone looks inside the tarball.
 */
const SECRET_SHAPED = [
  '.env',
  '.env.local',
  '.env.production',
  '.npmrc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'credentials',
  'secrets',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.keystore',
];

export const validateFlags: readonly FlagSpec[] = [
  {
    name: 'path',
    type: 'string',
    value: '<dir>',
    description:
      'Project directory to validate. Must be inside the working directory.',
  },
  {
    name: 'strict',
    type: 'boolean',
    description: 'Treat warnings as failures (exit 1 instead of 0).',
  },
];

export async function collectValidateChecks(
  system: SystemAccess,
  root: string,
): Promise<CheckResult[]> {
  const read = await system.readTextFile(join(root, 'package.json'));

  if (!read.ok) {
    return [
      {
        id: 'manifest.present',
        title: 'Manifest present',
        status: 'fail',
        summary: `package.json could not be read: ${read.reason}`,
        detail: { path: 'package.json' },
        remediation:
          'Run validate in a directory containing a readable package.json.',
      },
    ];
  }

  const parsedManifest = parseManifest('package.json', read.content);
  if (!parsedManifest.ok) {
    return [
      {
        id: 'manifest.parses',
        title: 'Manifest parses',
        status: 'fail',
        summary: `${parsedManifest.error.path}: ${parsedManifest.error.reason}`,
        detail: { path: parsedManifest.error.path },
        remediation: 'Fix the JSON syntax in package.json.',
      },
    ];
  }

  const manifest = parsedManifest.value;
  const entries = await system.readDirectory(root);
  const names = entries.map((entry) => entry.name);

  return [
    {
      id: 'manifest.parses',
      title: 'Manifest parses',
      status: 'pass',
      summary: 'package.json is valid JSON',
      detail: { path: 'package.json' },
    },
    requiredFieldsCheck(manifest),
    versionCheck(manifest),
    lockfileCheck(manifest, names),
    duplicateDependencyCheck(manifest),
    enginesCheck(manifest, system.nodeVersion),
    await tsStrictCheck(system, root, names),
    await referencedPathsCheck(system, root, manifest),
    publishedSecretsCheck(manifest, names),
  ];
}

function requiredFieldsCheck(manifest: Manifest): CheckResult {
  const missing: string[] = [];
  if (manifest.name === undefined || manifest.name.trim() === '') {
    missing.push('name');
  }
  if (manifest.version === undefined || manifest.version.trim() === '') {
    missing.push('version');
  }

  if (missing.length > 0) {
    return {
      id: 'manifest.fields',
      title: 'Required manifest fields',
      status: 'fail',
      summary: `missing: ${missing.join(', ')}`,
      detail: { missing },
      remediation: `Add ${missing.join(' and ')} to package.json.`,
    };
  }

  return {
    id: 'manifest.fields',
    title: 'Required manifest fields',
    status: 'pass',
    summary: `name '${manifest.name ?? ''}', version '${manifest.version ?? ''}'`,
    detail: { name: manifest.name ?? null, version: manifest.version ?? null },
  };
}

function versionCheck(manifest: Manifest): CheckResult {
  const version = manifest.version;
  if (version === undefined) {
    return {
      id: 'manifest.semver',
      title: 'Version is semantic',
      status: 'skip',
      summary: 'no version declared',
      detail: { version: null },
    };
  }

  if (!isValidSemVer(version)) {
    return {
      id: 'manifest.semver',
      title: 'Version is semantic',
      status: 'fail',
      summary: `'${version}' is not a valid semantic version`,
      detail: { version },
      remediation: 'Use MAJOR.MINOR.PATCH, for example 1.0.0.',
    };
  }

  return {
    id: 'manifest.semver',
    title: 'Version is semantic',
    status: 'pass',
    summary: version,
    detail: { version },
  };
}

function lockfileCheck(
  manifest: Manifest,
  names: readonly string[],
): CheckResult {
  const detection = detectFromLockfiles(names);
  const declared = managerFromField(manifest.packageManager);

  if (detection.files.length === 0) {
    return {
      id: 'lockfile.present',
      title: 'Lockfile',
      status: 'warn',
      summary: 'no lockfile committed',
      detail: { lockfiles: [], declared: declared ?? null },
      remediation:
        'Commit a lockfile so an install reproduces the tree that was tested.',
    };
  }

  if (detection.managers.length > 1) {
    return {
      id: 'lockfile.present',
      title: 'Lockfile',
      status: 'fail',
      summary: `conflicting lockfiles: ${detection.files.join(', ')}`,
      detail: { lockfiles: detection.files, managers: detection.managers },
      remediation:
        'Delete all but one. Two package managers resolve different trees.',
    };
  }

  const detected = detection.managers[0];
  if (declared !== undefined && declared !== detected) {
    return {
      id: 'lockfile.present',
      title: 'Lockfile',
      status: 'fail',
      summary: `packageManager declares ${declared} but ${detection.files.join(', ')} is committed`,
      detail: {
        lockfiles: detection.files,
        detected: detected ?? null,
        declared,
      },
      remediation:
        'Make the packageManager field and the committed lockfile agree.',
    };
  }

  return {
    id: 'lockfile.present',
    title: 'Lockfile',
    status: 'pass',
    summary: `${detection.files.join(', ')} (${detected ?? 'unknown'})`,
    detail: { lockfiles: detection.files, detected: detected ?? null },
  };
}

function duplicateDependencyCheck(manifest: Manifest): CheckResult {
  const duplicates = Object.keys(manifest.dependencies).filter(
    (name) => name in manifest.devDependencies,
  );

  if (duplicates.length > 0) {
    return {
      id: 'dependencies.duplicates',
      title: 'Dependency declarations',
      status: 'fail',
      summary: `declared in both dependencies and devDependencies: ${duplicates.join(', ')}`,
      detail: { duplicates },
      remediation:
        'Keep each package in one list. Which range wins is install-order dependent.',
    };
  }

  return {
    id: 'dependencies.duplicates',
    title: 'Dependency declarations',
    status: 'pass',
    summary: 'no package appears in two dependency lists',
    detail: { duplicates: [] },
  };
}

function enginesCheck(manifest: Manifest, nodeVersion: string): CheckResult {
  const range = manifest.engines['node'];

  if (range === undefined || range.trim() === '') {
    return {
      id: 'engines.node',
      title: 'Node engine range',
      status: 'warn',
      summary: 'engines.node is not declared',
      detail: { range: null, current: nodeVersion },
      remediation:
        'Declare engines.node so consumers learn the requirement before a runtime error does.',
    };
  }

  const outcome = satisfiesRange(nodeVersion, range);

  if (outcome === 'unsupported') {
    return {
      id: 'engines.node',
      title: 'Node engine range',
      status: 'warn',
      summary: `'${range}' uses range syntax this tool does not evaluate`,
      detail: { range, current: nodeVersion },
      remediation:
        'Verify the range manually; it was not checked rather than assumed to pass.',
    };
  }

  return {
    id: 'engines.node',
    title: 'Node engine range',
    status: outcome === 'satisfied' ? 'pass' : 'warn',
    summary:
      outcome === 'satisfied'
        ? `running Node ${nodeVersion} satisfies '${range}'`
        : `running Node ${nodeVersion} does not satisfy '${range}'`,
    detail: { range, current: nodeVersion, satisfied: outcome === 'satisfied' },
    ...(outcome === 'satisfied'
      ? {}
      : {
          remediation:
            'Switch to a Node version inside the declared range, or widen the range.',
        }),
  };
}

async function tsStrictCheck(
  system: SystemAccess,
  root: string,
  names: readonly string[],
): Promise<CheckResult> {
  if (!names.includes('tsconfig.json')) {
    return {
      id: 'tsconfig.strict',
      title: 'TypeScript strictness',
      status: 'skip',
      summary: 'no tsconfig.json to check',
      detail: { present: false },
    };
  }

  const read = await system.readTextFile(join(root, 'tsconfig.json'));
  if (!read.ok) {
    return {
      id: 'tsconfig.strict',
      title: 'TypeScript strictness',
      status: 'fail',
      summary: `tsconfig.json could not be read: ${read.reason}`,
      detail: { present: true },
      remediation: 'Check the file permissions and size.',
    };
  }

  const config = parseTsConfig('tsconfig.json', read.content);
  if (!config.ok) {
    return {
      id: 'tsconfig.strict',
      title: 'TypeScript strictness',
      status: 'fail',
      summary: `tsconfig.json could not be parsed: ${config.error.reason}`,
      detail: { present: true },
      remediation: 'Fix the JSON syntax in tsconfig.json.',
    };
  }

  if (config.value.strict === true) {
    return {
      id: 'tsconfig.strict',
      title: 'TypeScript strictness',
      status: 'pass',
      summary: 'strict is enabled',
      detail: { strict: true, strictFamily: config.value.strictFamily },
    };
  }

  const inherited = config.value.extends;
  return {
    id: 'tsconfig.strict',
    title: 'TypeScript strictness',
    status: config.value.strict === false ? 'fail' : 'warn',
    summary:
      config.value.strict === false
        ? 'strict is explicitly disabled'
        : inherited === undefined
          ? 'strict is not set'
          : `strict is not set here; it may be inherited from '${inherited}'`,
    detail: {
      strict: config.value.strict ?? null,
      extends: inherited ?? null,
    },
    remediation: 'Set "strict": true in compilerOptions.',
  };
}

/**
 * Every path the manifest promises to ship must exist. A `bin` entry
 * pointing at a file that was never built installs a command that fails on
 * first use, and nothing before publication catches it.
 */
async function referencedPathsCheck(
  system: SystemAccess,
  root: string,
  manifest: Manifest,
): Promise<CheckResult> {
  const referenced = new Map<string, string>();
  if (manifest.main !== undefined) referenced.set(manifest.main, 'main');
  if (manifest.types !== undefined) referenced.set(manifest.types, 'types');
  for (const [name, target] of Object.entries(manifest.bin)) {
    referenced.set(target, `bin.${name}`);
  }
  for (const target of manifest.exportPaths) {
    referenced.set(target, 'exports');
  }

  if (referenced.size === 0) {
    return {
      id: 'manifest.paths',
      title: 'Referenced paths exist',
      status: 'skip',
      summary: 'the manifest references no entry-point paths',
      detail: { referenced: [] },
    };
  }

  const missing: { path: string; field: string }[] = [];
  for (const [path, field] of referenced) {
    // A wildcard subpath export cannot be resolved to a single file.
    if (path.includes('*')) continue;
    const stat = await system.statPath(join(root, path));
    if (stat === undefined) missing.push({ path, field });
  }

  if (missing.length > 0) {
    return {
      id: 'manifest.paths',
      title: 'Referenced paths exist',
      status: 'fail',
      summary: missing
        .map((entry) => `${entry.field} → ${entry.path} (missing)`)
        .join('; '),
      detail: { missing },
      remediation:
        'Build the package before validating, or correct the paths in package.json.',
    };
  }

  return {
    id: 'manifest.paths',
    title: 'Referenced paths exist',
    status: 'pass',
    summary: `${referenced.size} referenced path(s) present`,
    detail: { referenced: [...referenced.keys()] },
  };
}

function publishedSecretsCheck(
  manifest: Manifest,
  names: readonly string[],
): CheckResult {
  const suspicious = manifest.files.filter((entry) =>
    SECRET_SHAPED.some((pattern) => matchesSecretPattern(entry, pattern)),
  );

  // A `files` list is an allowlist; without one, npm falls back to
  // `.npmignore` or `.gitignore`, which is the easier configuration to get
  // wrong, so its absence is worth saying out loud.
  if (manifest.files.length === 0) {
    const hasNpmIgnore = names.includes('.npmignore');
    return {
      id: 'publish.secrets',
      title: 'Publishable file list',
      status: 'warn',
      summary: hasNpmIgnore
        ? 'no files allowlist; publication is governed by .npmignore'
        : 'no files allowlist; publication falls back to .gitignore',
      detail: { files: [], npmignore: hasNpmIgnore },
      remediation:
        'Declare a "files" allowlist so publication includes only what you intend.',
    };
  }

  if (suspicious.length > 0) {
    return {
      id: 'publish.secrets',
      title: 'Publishable file list',
      status: 'fail',
      summary: `files includes secret-shaped paths: ${suspicious.join(', ')}`,
      detail: { suspicious },
      remediation:
        'Remove these from "files". A published credential cannot be unpublished.',
    };
  }

  return {
    id: 'publish.secrets',
    title: 'Publishable file list',
    status: 'pass',
    summary: `${manifest.files.length} entr${manifest.files.length === 1 ? 'y' : 'ies'}, none secret-shaped`,
    detail: { files: manifest.files },
  };
}

function matchesSecretPattern(entry: string, pattern: string): boolean {
  const normalised = entry.replace(/^\.\//, '').toLowerCase();
  if (pattern.startsWith('*')) {
    return normalised.endsWith(pattern.slice(1).toLowerCase());
  }
  return (
    normalised === pattern.toLowerCase() ||
    normalised.startsWith(`${pattern.toLowerCase()}/`)
  );
}

export const validateCommand: CommandDefinition = {
  name: 'validate',
  summary: 'Project and configuration validation.',
  usage: 'sablectl validate [--path <dir>] [--strict] [options]',
  description: [
    'Runs named checks over the manifest, lockfile, dependency declarations,',
    'engine range, TypeScript strictness, referenced entry-point paths and',
    'the publishable file list. Each check reports pass, warn or fail with a',
    'remediation. --strict promotes warnings to failures, so exit code 1',
    'means "something needs attention" rather than only "something is wrong".',
  ],
  flags: validateFlags,
  async run(ctx: CommandContext) {
    const root = resolveProjectPath(ctx.cwd, option(ctx.flags, 'path'));
    const results = await collectValidateChecks(ctx.system, root);
    return {
      command: 'validate',
      version: VERSION,
      generatedAt: ctx.system.now().toISOString(),
      sections: [
        {
          title: flag(ctx.flags, 'strict')
            ? 'Validation (strict)'
            : 'Validation',
          results,
        },
      ],
    };
  },
};
