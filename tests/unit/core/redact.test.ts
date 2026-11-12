import { describe, expect, it } from 'vitest';
import {
  containsCredential,
  redactCredentials,
} from '../../../src/core/redact.js';

// Assembled at runtime so no credential-shaped literal exists in the
// repository: the pre-push gate and secret scanners cannot tell a test
// fixture from a real leak, and they should not have to.
const TOKEN = ['ghp', 'EXAMPLETOKEN1234567890'].join('_');

describe('redactCredentials', () => {
  it('redacts a user:token pair embedded in an https remote', () => {
    const input = `https://sable:${TOKEN}@github.com/x/y.git`;
    const output = redactCredentials(input);

    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain('sable');
    expect(output).toBe('https://***:***@github.com/x/y.git');
  });

  it('redacts a bare-username userinfo section', () => {
    expect(redactCredentials('https://sable@github.com/x/y.git')).toBe(
      'https://***@github.com/x/y.git',
    );
  });

  it('leaves the SSH shorthand form intact', () => {
    const input = 'git@github.com:owner/repo.git';
    expect(redactCredentials(input)).toBe(input);
    expect(containsCredential(input)).toBe(false);
  });

  it('leaves a credential-free https remote intact', () => {
    const input = 'https://github.com/owner/repo.git';
    expect(redactCredentials(input)).toBe(input);
    expect(containsCredential(input)).toBe(false);
  });

  it('masks a loose GitHub token anywhere in the string', () => {
    expect(redactCredentials(`token=${TOKEN} trailing`)).toBe(
      'token=*** trailing',
    );
    expect(redactCredentials('gho_ANOTHEREXAMPLETOKEN00')).toBe('***');
  });

  it('masks a fine-grained github_pat_ token', () => {
    const pat = ['github', 'pat', '11ABCDEFG0abcdefghijklmnop'].join('_');
    expect(redactCredentials(`url?pat=${pat}`)).toBe('url?pat=***');
  });

  it('masks a GitLab personal access token', () => {
    expect(redactCredentials('glpat-ABCDEFGHIJKLMNOPQRST')).toBe('***');
  });

  it('masks an AWS access key id', () => {
    const accessKeyId = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    expect(redactCredentials(`${accessKeyId} used here`)).toBe('*** used here');
  });

  it('masks every Slack token prefix', () => {
    for (const prefix of ['xoxb', 'xoxa', 'xoxp', 'xoxr', 'xoxs']) {
      const token = `${prefix}-1234567890-abcdefghij`;
      expect(redactCredentials(token)).toBe('***');
    }
  });

  it('redacts a credential hidden in an ssh:// URL userinfo section', () => {
    expect(redactCredentials(`ssh://user:${TOKEN}@host/repo.git`)).toBe(
      'ssh://***:***@host/repo.git',
    );
  });

  it('redacts each remote in a multi-line value', () => {
    const input = [
      `origin\thttps://sable:${TOKEN}@github.com/x/y.git (fetch)`,
      'backup\tgit@github.com:owner/repo.git (push)',
    ].join('\n');

    const output = redactCredentials(input);

    expect(output).not.toContain(TOKEN);
    expect(output).toContain('git@github.com:owner/repo.git');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactCredentials('nothing secret here')).toBe(
      'nothing secret here',
    );
    expect(redactCredentials('')).toBe('');
  });
});

describe('containsCredential', () => {
  it('is true exactly when redaction changes the value', () => {
    expect(
      containsCredential(`https://sable:${TOKEN}@github.com/x/y.git`),
    ).toBe(true);
    expect(containsCredential(TOKEN)).toBe(true);
    expect(containsCredential('https://github.com/x/y.git')).toBe(false);
  });
});
