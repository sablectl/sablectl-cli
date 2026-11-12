import type { CheckResult } from '../core/check.js';
import type { CommandContext, CommandDefinition } from '../core/command.js';
import { VERSION } from '../core/version.js';
import { normaliseVersion, satisfiesRange } from '../parse/semver.js';
import type { SystemAccess } from '../platform/types.js';

/**
 * The Node range this tool supports. Kept beside the checks that use it so
 * the support claim and the verification of it cannot drift apart.
 */
export const SUPPORTED_NODE_RANGE = '>=20.19';

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

/**
 * Environment variables that mean "this is an automated build". Checked by
 * presence, not value: `CI=false` is set by at least one popular system to
 * mean "not a CI build", so the value is honoured where it is explicit.
 */
const CI_VARIABLES = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'TRAVIS',
  'TEAMCITY_VERSION',
  'JENKINS_URL',
] as const;

export async function collectEnvChecks(
  system: SystemAccess,
): Promise<CheckResult[]> {
  const os = system.osInfo();

  const results: CheckResult[] = [
    {
      id: 'os.platform',
      title: 'Operating system',
      status: 'info',
      summary: `${os.type} ${os.release} (${os.platform})`,
      detail: { type: os.type, release: os.release, platform: os.platform },
    },
    {
      id: 'os.cpu',
      title: 'CPU',
      status: 'info',
      summary: `${os.arch}, ${os.cpus} logical core${os.cpus === 1 ? '' : 's'}`,
      detail: { arch: os.arch, cores: os.cpus },
    },
    {
      id: 'os.memory',
      title: 'Memory',
      status: 'info',
      summary: `${formatBytes(os.totalMemoryBytes)} total, ${formatBytes(os.freeMemoryBytes)} free`,
      detail: {
        totalBytes: os.totalMemoryBytes,
        freeBytes: os.freeMemoryBytes,
      },
    },
    nodeCheck(system),
  ];

  // Probed concurrently: four sequential subprocess launches would dominate
  // the runtime of a command that is supposed to answer in under a second.
  const managerChecks = await Promise.all(
    PACKAGE_MANAGERS.map((manager) => packageManagerCheck(system, manager)),
  );
  results.push(...managerChecks);

  results.push(shellCheck(system), ciCheck(system));

  return results;
}

function nodeCheck(system: SystemAccess): CheckResult {
  const version = normaliseVersion(system.nodeVersion);
  const outcome = satisfiesRange(version, SUPPORTED_NODE_RANGE);

  if (outcome === 'satisfied') {
    return {
      id: 'node.version',
      title: 'Node.js',
      status: 'pass',
      summary: `v${version} satisfies ${SUPPORTED_NODE_RANGE}`,
      detail: { version, supported: SUPPORTED_NODE_RANGE },
    };
  }

  if (outcome === 'unsupported') {
    return {
      id: 'node.version',
      title: 'Node.js',
      status: 'warn',
      summary: `v${version} could not be compared against ${SUPPORTED_NODE_RANGE}`,
      detail: { version, supported: SUPPORTED_NODE_RANGE },
      remediation: 'Report this version string: the comparison is unsupported.',
    };
  }

  return {
    id: 'node.version',
    title: 'Node.js',
    status: 'fail',
    summary: `v${version} is below the supported range ${SUPPORTED_NODE_RANGE}`,
    detail: { version, supported: SUPPORTED_NODE_RANGE },
    remediation: `Install Node ${SUPPORTED_NODE_RANGE} — older releases lack APIs this tool relies on.`,
  };
}

async function packageManagerCheck(
  system: SystemAccess,
  manager: string,
): Promise<CheckResult> {
  const result = await system.exec(manager, ['--version'], {
    timeoutMs: 4_000,
  });

  if (!result.ran || result.code !== 0) {
    return {
      id: `packageManager.${manager}`,
      title: `Package manager: ${manager}`,
      status: 'info',
      summary: 'not installed',
      detail: { installed: false },
    };
  }

  const version = result.stdout.trim().split('\n')[0] ?? 'unknown';
  return {
    id: `packageManager.${manager}`,
    title: `Package manager: ${manager}`,
    status: 'pass',
    summary: `v${version.replace(/^v/, '')}`,
    detail: { installed: true, version: version.replace(/^v/, '') },
  };
}

function shellCheck(system: SystemAccess): CheckResult {
  const shell =
    system.env['SHELL'] ?? system.env['ComSpec'] ?? system.env['COMSPEC'];

  if (shell === undefined || shell === '') {
    return {
      id: 'shell',
      title: 'Shell',
      status: 'info',
      summary: 'not reported by the environment',
      detail: { shell: null },
    };
  }

  return {
    id: 'shell',
    title: 'Shell',
    status: 'info',
    summary: shell,
    detail: { shell },
  };
}

function ciCheck(system: SystemAccess): CheckResult {
  const matched = CI_VARIABLES.filter((name) => {
    const value = system.env[name];
    return value !== undefined && value !== '' && value !== 'false';
  });

  return {
    id: 'ci',
    title: 'Continuous integration',
    status: 'info',
    summary:
      matched.length === 0
        ? 'not detected — this looks like an interactive environment'
        : `detected via ${matched.join(', ')}`,
    detail: { detected: matched.length > 0, variables: matched },
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unit] ?? 'B'}`;
}

export const envCommand: CommandDefinition = {
  name: 'env',
  summary: 'Runtime and operating-system information.',
  usage: 'sablectl env [options]',
  description: [
    'Reports the operating system, CPU, memory, Node.js version against the',
    'supported range, installed package managers, shell, and whether a',
    'continuous-integration environment is detected.',
  ],
  flags: [],
  async run(ctx: CommandContext) {
    const results = await collectEnvChecks(ctx.system);
    return {
      command: 'env',
      version: VERSION,
      generatedAt: ctx.system.now().toISOString(),
      sections: [{ title: 'Environment', results }],
    };
  },
};
