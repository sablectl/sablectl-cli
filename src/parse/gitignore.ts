/**
 * A deliberately partial `.gitignore` matcher.
 *
 * Git's ignore semantics are larger than they look (precedence, negation,
 * nested ignore files, `**` in several positions). Reimplementing all of it
 * would be a project in itself, so this covers the common forms used to keep
 * build output out of a directory summary: literal names, directory
 * suffixes, leading-slash anchoring, `*` and `?` wildcards, `**` segments,
 * and `!` negation in declaration order.
 *
 * It is used only to make `inspect` output readable. Nothing security-
 * relevant depends on it, which is why an approximation is acceptable here
 * and would not be elsewhere.
 */
export interface IgnoreRule {
  readonly pattern: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly matcher: RegExp;
}

export function parseGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;

    const negated = line.startsWith('!');
    const body = negated ? line.slice(1) : line;
    const directoryOnly = body.endsWith('/');
    const trimmed = directoryOnly ? body.slice(0, -1) : body;
    if (trimmed === '') continue;

    rules.push({
      pattern: trimmed,
      negated,
      directoryOnly,
      matcher: toRegExp(trimmed),
    });
  }

  return rules;
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith('/');
  const body = anchored ? pattern.slice(1) : pattern;

  let source = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body.charAt(index);
    if (char === '*') {
      if (body.charAt(index + 1) === '*') {
        source += '.*';
        index += 1;
        if (body.charAt(index + 1) === '/') index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  // An unanchored pattern matches at any depth, exactly as Git does for a
  // pattern containing no slash.
  const prefix = anchored || body.includes('/') ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${source}(?:/.*)?$`);
}

export function isIgnored(
  rules: readonly IgnoreRule[],
  relativePath: string,
  isDirectory: boolean,
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (!rule.matcher.test(relativePath)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}
