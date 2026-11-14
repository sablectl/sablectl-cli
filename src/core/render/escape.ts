/**
 * Terminal-safety helper for human-readable output.
 *
 * Branch names, remote URLs, commit subjects and directory names all come
 * from outside the process, which makes them attacker-controlled on any
 * machine worth inspecting. A branch called `\u001B[2K\rPASS  all checks`
 * would otherwise rewrite the line above it in a terminal and fake a clean
 * report, so every untrusted string is passed through
 * `escapeControlCharacters` before it is printed. Unicode text stays
 * readable; only control characters are escaped.
 *
 * This applies to the human renderer only. JSON output is already safe
 * because JSON encoding escapes control characters, and escaping there
 * would corrupt the data a consumer parses.
 */

/** Replaces control characters with visible `\xNN` / `\uNNNN` escapes. */
export function escapeControlCharacters(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
      continue;
    }
    // C1 controls and the bidirectional overrides used for spoofing.
    if ((code >= 0x80 && code <= 0x9f) || (code >= 0x202a && code <= 0x202e)) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += char;
  }
  return out;
}
