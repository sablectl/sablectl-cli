import { describe, expect, it } from 'vitest';
import {
  compareSemVer,
  formatSemVer,
  isValidSemVer,
  normaliseVersion,
  parseSemVer,
  satisfiesRange,
} from '../../../src/parse/semver.js';

function parsed(value: string) {
  const version = parseSemVer(value);
  if (version === undefined) {
    throw new Error(`expected '${value}' to parse`);
  }
  return version;
}

describe('parseSemVer', () => {
  it('parses a plain version', () => {
    expect(parseSemVer('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: undefined,
    });
  });

  it('parses a prerelease and ignores build metadata', () => {
    expect(parseSemVer('1.2.3-beta.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'beta.1',
    });
    expect(parseSemVer('1.2.3+build.5')?.prerelease).toBeUndefined();
    expect(parseSemVer('1.2.3-rc.1+build.5')?.prerelease).toBe('rc.1');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseSemVer('  20.19.0 ')?.major).toBe(20);
  });

  it('refuses partial, prefixed and nonsense versions', () => {
    for (const value of ['', '20', '20.19', 'v20.19.0', 'x.y.z', '1.2.3.4']) {
      expect(parseSemVer(value)).toBeUndefined();
      expect(isValidSemVer(value)).toBe(false);
    }
  });

  it('round-trips through formatSemVer', () => {
    expect(formatSemVer(parsed('1.2.3'))).toBe('1.2.3');
    expect(formatSemVer(parsed('1.2.3-rc.1'))).toBe('1.2.3-rc.1');
  });
});

describe('compareSemVer', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareSemVer(parsed('2.0.0'), parsed('1.9.9'))).toBeGreaterThan(0);
    expect(compareSemVer(parsed('1.2.0'), parsed('1.10.0'))).toBeLessThan(0);
    expect(compareSemVer(parsed('1.2.3'), parsed('1.2.4'))).toBeLessThan(0);
    expect(compareSemVer(parsed('1.2.3'), parsed('1.2.3'))).toBe(0);
  });

  it('sorts a prerelease below its own release', () => {
    expect(compareSemVer(parsed('1.2.3-rc.1'), parsed('1.2.3'))).toBeLessThan(
      0,
    );
    expect(
      compareSemVer(parsed('1.2.3'), parsed('1.2.3-rc.1')),
    ).toBeGreaterThan(0);
  });

  it('orders two prereleases of the same version', () => {
    expect(
      compareSemVer(parsed('1.2.3-alpha'), parsed('1.2.3-beta')),
    ).toBeLessThan(0);
    expect(compareSemVer(parsed('1.2.3-rc.1'), parsed('1.2.3-rc.1'))).toBe(0);
  });

  it('sorts a list into ascending order', () => {
    const sorted = ['1.2.3', '1.0.0', '1.2.3-rc.1', '2.0.0', '1.3.0']
      .map(parsed)
      .sort(compareSemVer)
      .map(formatSemVer);

    expect(sorted).toEqual(['1.0.0', '1.2.3-rc.1', '1.2.3', '1.3.0', '2.0.0']);
  });
});

describe('normaliseVersion', () => {
  it('completes partial versions and strips a leading v', () => {
    expect(normaliseVersion('20')).toBe('20.0.0');
    expect(normaliseVersion('20.19')).toBe('20.19.0');
    expect(normaliseVersion('v20.19.0')).toBe('20.19.0');
    expect(normaliseVersion(' 22.11.0 ')).toBe('22.11.0');
  });
});

describe('satisfiesRange', () => {
  it('treats the wildcard and the empty range as satisfied', () => {
    expect(satisfiesRange('20.19.0', '*')).toBe('satisfied');
    expect(satisfiesRange('20.19.0', 'x')).toBe('satisfied');
    expect(satisfiesRange('20.19.0', '  ')).toBe('satisfied');
  });

  it('evaluates >=20.19 as the tool itself declares it', () => {
    expect(satisfiesRange('20.19.0', '>=20.19')).toBe('satisfied');
    expect(satisfiesRange('22.11.0', '>=20.19')).toBe('satisfied');
    expect(satisfiesRange('20.19.1', '>=20.19')).toBe('satisfied');
    expect(satisfiesRange('20.18.3', '>=20.19')).toBe('unsatisfied');
    expect(satisfiesRange('18.20.0', '>=20.19')).toBe('unsatisfied');
  });

  it('evaluates the simple comparators', () => {
    expect(satisfiesRange('1.2.3', '=1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.2.4', '=1.2.3')).toBe('unsatisfied');
    expect(satisfiesRange('1.2.4', '>1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.2.3', '>1.2.3')).toBe('unsatisfied');
    expect(satisfiesRange('1.2.2', '<1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.2.3', '<=1.2.3')).toBe('satisfied');
  });

  it('evaluates a caret range within the leftmost non-zero component', () => {
    expect(satisfiesRange('1.2.3', '^1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.9.0', '^1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.2.2', '^1.2.3')).toBe('unsatisfied');
    expect(satisfiesRange('2.0.0', '^1.2.3')).toBe('unsatisfied');
    expect(satisfiesRange('0.2.9', '^0.2.3')).toBe('satisfied');
    expect(satisfiesRange('0.3.0', '^0.2.3')).toBe('unsatisfied');
  });

  it('evaluates a tilde range within the same minor', () => {
    expect(satisfiesRange('1.2.3', '~1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe('satisfied');
    expect(satisfiesRange('1.2.2', '~1.2.3')).toBe('unsatisfied');
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe('unsatisfied');
  });

  it('requires every comparator of a conjunction', () => {
    expect(satisfiesRange('20.19.0', '>=20 <23')).toBe('satisfied');
    expect(satisfiesRange('22.11.0', '>=20 <23')).toBe('satisfied');
    expect(satisfiesRange('23.0.0', '>=20 <23')).toBe('unsatisfied');
    expect(satisfiesRange('19.9.0', '>=20 <23')).toBe('unsatisfied');
  });

  it('accepts any alternative of a || range', () => {
    expect(satisfiesRange('18.0.0', '18 || 20')).toBe('satisfied');
    expect(satisfiesRange('20.0.0', '18 || 20')).toBe('satisfied');
    expect(satisfiesRange('19.0.0', '18 || 20')).toBe('unsatisfied');
    expect(satisfiesRange('20.19.0', '>=18 <19 || >=20')).toBe('satisfied');
  });

  it('treats a partial version with no operator as an X-range', () => {
    // `18` means ">=18.0.0 <19.0.0", not "exactly 18.0.0". Reading it as
    // equality made a real `engines.node: "18 || 20"` report a perfectly
    // valid Node 18.20.0 as unsatisfied.
    expect(satisfiesRange('18.20.8', '18')).toBe('satisfied');
    expect(satisfiesRange('18.20.8', '18 || 20')).toBe('satisfied');
    expect(satisfiesRange('19.0.0', '18')).toBe('unsatisfied');

    // Two components narrow to the minor: `18.20` is ">=18.20.0 <18.21.0".
    expect(satisfiesRange('18.20.8', '18.20')).toBe('satisfied');
    expect(satisfiesRange('18.19.0', '18.20')).toBe('unsatisfied');

    // A complete version with no operator stays an exact match.
    expect(satisfiesRange('18.20.8', '18.20.8')).toBe('satisfied');
    expect(satisfiesRange('18.20.9', '18.20.8')).toBe('unsatisfied');
  });

  it('reports an unsupported range rather than a false pass', () => {
    for (const range of ['>=lts/*', 'not-a-range', '>=20.x']) {
      expect(satisfiesRange('20.19.0', range)).toBe('unsupported');
    }
    // A hyphen range: the bound parses, the separator does not, so the
    // answer is "not evaluated" rather than a pass that was never checked.
    expect(satisfiesRange('1.2.3', '1.2.3 - 2.0.0')).toBe('unsupported');
  });

  it('reports an unparseable version as unsupported', () => {
    expect(satisfiesRange('not-a-version', '>=20')).toBe('unsupported');
  });

  it('prefers a satisfied alternative over an unsupported one', () => {
    expect(satisfiesRange('20.19.0', '1.2.3 - 2.0.0 || >=20')).toBe(
      'satisfied',
    );
  });
});
