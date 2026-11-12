/**
 * Credential redaction for anything derived from repository configuration.
 *
 * A Git remote may legitimately contain an embedded credential
 * (`https://user:token@host/owner/repo.git`). Printing it — to a terminal
 * that scrolls into a screenshot, or to JSON that a CI job archives — leaks
 * it. Redaction happens at the boundary where a value enters a report, so no
 * individual check has to remember to do it.
 */

const REDACTED = '***';

/**
 * Patterns for tokens that may appear outside a URL userinfo section, for
 * example in `git remote -v` output that embeds a token in a query string.
 * Deliberately conservative: a false positive costs a few hidden characters,
 * a false negative costs a published credential.
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
];

/**
 * Removes userinfo from a URL-shaped string and masks token-shaped
 * substrings anywhere else in it.
 *
 * Non-URL input is still scanned for token shapes, because an SSH remote can
 * carry one in a path and a malformed URL must not fall through unredacted.
 */
export function redactCredentials(value: string): string {
  let result = value;

  // scheme://userinfo@host — the userinfo is replaced wholesale. The username
  // is masked too: a username can itself be a token, and the username is not
  // information the report needs.
  result = result.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g,
    (_match, scheme: string, userinfo: string) => {
      // `git@github.com:owner/repo` style SSH shorthand has no `//` and does
      // not reach here. A userinfo with no colon is a bare username, which is
      // masked for the same reason.
      return userinfo.includes(':')
        ? `${scheme}${REDACTED}:${REDACTED}@`
        : `${scheme}${REDACTED}@`;
    },
  );

  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }

  return result;
}

/** True when the original value contained something worth redacting. */
export function containsCredential(value: string): boolean {
  return redactCredentials(value) !== value;
}
