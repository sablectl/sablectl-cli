# Command reference

Every command accepts the global flags below and emits either a human-readable report or, with `--json`, a versioned JSON envelope.

## Global flags

| Flag              | Effect                                              |
| ----------------- | --------------------------------------------------- |
| `-h`, `--help`    | Show help. `sablectl help <command>` is equivalent. |
| `-V`, `--version` | Print `sablectl v<version>` and exit `0`.           |
| `--json`          | Emit the machine-readable report instead of text.   |
| `-v`, `--verbose` | Include each check's structured detail in the text. |
| `--no-color`      | Disable colour regardless of terminal detection.    |

`--` ends flag parsing. An unknown flag is a usage error (exit `2`), never ignored: a silently ignored typo is how a CI job passes while checking nothing.

## `sablectl doctor`

```
sablectl doctor [--path <dir>] [--strict]
```

Runs the environment, Git, project and validation check sets and presents each as a section ordered worst-first. It contains no checks of its own, so it cannot disagree with the individual commands.

## `sablectl env`

```
sablectl env
```

| Check id              | Reports                                                     |
| --------------------- | ----------------------------------------------------------- |
| `os.platform`         | OS type, kernel release, platform identifier                |
| `os.cpu`              | Architecture and logical core count                         |
| `os.memory`           | Total and free memory                                       |
| `node.version`        | Node version against `>=20.19` — `fail` when below it       |
| `packageManager.npm`… | npm, pnpm, yarn and bun presence and version                |
| `shell`               | `SHELL`, or `ComSpec` on Windows                            |
| `ci`                  | Whether a CI environment is detected, and by which variable |

Package managers are probed concurrently; an absent one is `info`, not a failure.

## `sablectl git`

```
sablectl git
```

| Check id         | Reports                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| `git.version`    | Installed Git version; `fail` if Git is absent                              |
| `git.repository` | Whether the directory is inside a working tree; `fail` with exit `1` if not |
| `git.branch`     | Branch name, or detached HEAD / unborn branch as a `warn`                   |
| `git.upstream`   | Upstream ref and ahead/behind counts; `warn` when both are non-zero         |
| `git.status`     | Staged, unstaged, untracked and conflicted counts                           |
| `git.stash`      | Stash entry count                                                           |
| `git.lastCommit` | Short hash, author, relative date, subject                                  |
| `git.remotes`    | Remote names and URLs, **credentials redacted**                             |

Counts come from `git status --porcelain=v2 -z`. Git older than 2.11 has no v2 format, so the report falls back to v1 and **says so in the summary** rather than presenting a possibly-wrong number as fact.

## `sablectl inspect`

```
sablectl inspect [--path <dir>]
```

Detected project type, package manager inferred from the lockfile (and any disagreement with `packageManager`), workspaces, declared scripts, dependency counts, TypeScript configuration and `strict` status, test framework, and a bounded directory summary.

The summary walks at most 3 levels and 2000 entries, skips `node_modules`, `.git`, `dist`, `build`, `coverage` and similar, honours `.gitignore`, and reports symlinks without following them. When a bound stops the traversal the summary says it was truncated.

## `sablectl validate`

```
sablectl validate [--path <dir>] [--strict]
```

| Check id                  | Fails when                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `manifest.parses`         | `package.json` is unreadable or not valid JSON                                               |
| `manifest.fields`         | `name` or `version` is missing                                                               |
| `manifest.semver`         | `version` is not a valid semantic version                                                    |
| `lockfile.present`        | Conflicting lockfiles, or disagreement with `packageManager` (warns when no lockfile at all) |
| `dependencies.duplicates` | A package appears in both `dependencies` and `devDependencies`                               |
| `engines.node`            | Warns when absent, or when the running Node is outside the range                             |
| `tsconfig.strict`         | `strict` is explicitly `false` (warns when merely unset)                                     |
| `manifest.paths`          | A `main`, `types`, `bin` or `exports` path does not exist                                    |
| `publish.secrets`         | `files` lists a secret-shaped path; warns when there is no `files` allowlist                 |

`--strict` promotes every warning to a failure, changing the exit code from `0` to `1`.

## Exit codes

| Code | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| `0`  | Success; every check passed                               |
| `1`  | A check failed, or the command cannot run in this context |
| `2`  | Usage error                                               |
| `3`  | Unexpected internal error                                 |

## Using it in CI

```yaml
- run: node dist/bin/sablectl.js validate --strict --json > validation.json
```

A non-zero exit fails the step. The JSON is stable enough to diff between runs: key order is fixed and only `generatedAt` changes when nothing else has.
