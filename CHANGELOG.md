# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-11-12

First stable release.

### Added

- **`sablectl doctor`** — the environment, Git, project and validation checks in one report, ordered by severity.
- **`sablectl env`** — operating system, kernel release, architecture, core count, memory, Node version against the supported range, npm/pnpm/yarn/bun detection, shell, and CI detection.
- **`sablectl git`** — Git version, repository detection, branch or detached HEAD, upstream ahead/behind, staged/unstaged/untracked/conflicted counts, stash count, last commit, and remotes with embedded credentials redacted.
- **`sablectl inspect`** — project type, package manager inferred from the lockfile, workspaces, scripts, dependency counts, TypeScript configuration and `strict` status, test-framework detection, and a bounded directory summary honouring `.gitignore`.
- **`sablectl validate`** — nine named checks over the manifest, lockfile, dependency declarations, engine range, TypeScript strictness, referenced entry-point paths and the publishable file list, each with a remediation. `--strict` promotes warnings to failures.
- `--help` and `help <command>`, generated from the command registry; an unknown command suggests the closest match by edit distance.
- `--version`, read from the package manifest at runtime rather than from a literal.
- `--json` on every command, with a `schemaVersion`-stamped envelope versioned independently of the tool.
- Documented exit codes: `0` success, `1` checks failed or the command cannot run here, `2` usage error, `3` internal error.
- Colour handling honouring `--no-color`, `NO_COLOR`, `TERM=dumb`, `FORCE_COLOR` and TTY detection, with byte-identical monochrome output under each suppressing condition.

### Security

- All subprocess execution uses `execFile` with an argument array and `shell: false`, with a timeout, an output cap, and `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C` pinned.
- Remote URLs are redacted of embedded credentials at the point they enter a report.
- `--path` is refused if it resolves outside the working directory.
- Directory traversal is bounded by depth and entry count and never follows symlinks.
- File reads are size-capped, enforced through the open file handle.
- External data is parsed into discriminated results; no type assertion is made on untrusted input.

### Notes

- **Zero runtime dependencies.** The shipped `dist/` output depends on nothing but the Node standard library.
- **Not published to npm.** GitHub releases are the distribution channel for this version.
- CI verifies Linux on Node 20.19, 22 and 24. macOS and Windows are expected to work but are untested.

[1.0.0]: https://github.com/sablectl/sablectl-cli/releases/tag/v1.0.0
