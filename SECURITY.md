# Security

## Reporting a vulnerability

**Do not open a public issue.**

Report privately through GitHub: <https://github.com/sablectl/sablectl-cli/security/advisories/new>. That channel is private to the maintainer until an advisory is published.

Please include what you did, what happened, what you expected, and the version (`sablectl --version`). A proof of concept is welcome but not required — a clear description of the mechanism is enough to start.

You should get an acknowledgement within 72 hours. Fixes are released as soon as they are ready; a credited advisory is published alongside unless you ask otherwise. There is no bounty programme.

## Threat model

`sablectl` is a local, read-only diagnostic tool. It opens no network connections, writes no files, and holds no credentials. Its interesting inputs are therefore:

| Input                                       | Trust                         |
| ------------------------------------------- | ----------------------------- |
| Command-line arguments                      | Untrusted                     |
| `package.json`, `tsconfig.json`, lockfiles  | Untrusted — arbitrary content |
| `git` output (branch names, remotes, paths) | Untrusted                     |
| Environment variables                       | Untrusted                     |
| Directory contents, including symlinks      | Untrusted                     |

The attacks that matter are therefore: executing something because a repository contained a hostile name; reading or disclosing a file outside the project; leaking a credential embedded in a remote URL; and hanging or exhausting memory on a pathological input.

## Controls, and why each is where it is

**Command injection — closed structurally.** All subprocess execution goes through `src/platform/process.ts`, which uses `execFile` with an argument array and `shell: false`. No string built from repository data is ever parsed by a shell, so a branch named `; rm -rf ~` or `$(id)` is just an unusually-named branch. This is a property of the mechanism, not a filter that must anticipate every metacharacter. Integration tests create fixtures with exactly those names and assert nothing executes.

**Credential disclosure — redacted at the boundary.** A Git remote may legitimately contain `https://user:token@host/…`. `src/core/redact.ts` strips userinfo and masks token-shaped substrings (`ghp_`, `github_pat_`, `glpat-`, AWS `AKIA`, Slack `xox…`), and remotes pass through it at the point they enter a report — so no renderer, present or future, has to remember to do it. A test greps the full human **and** JSON output for the token substring and fails if it appears anywhere.

**Path traversal — refused, not sanitised.** `--path` is resolved and asserted to remain inside the working directory (`src/core/project.ts`); anything escaping it is a usage error with exit `2`. Sanitising would invite a bypass; refusing costs a legitimate user one `cd`.

**Symlinks — recorded, never followed.** `src/platform/fswalk.ts` reports a symlink and does not enter it. One rule closes two problems: a link out of the project cannot be used to read elsewhere, and a self-referential loop cannot hang the process.

**Resource exhaustion — bounded everywhere.** File reads are capped at 1 MiB, checked through the open handle so the file cannot be swapped between the check and the read. Subprocesses have a timeout and a 2 MiB output cap. Traversal is bounded by depth (3) and entry count (2000). Recursive `exports` parsing is depth-bounded. When a bound is hit, the output says so.

**Subprocess environment — pinned.** `GIT_TERMINAL_PROMPT=0` so Git cannot block waiting for a credential; `GIT_OPTIONAL_LOCKS=0` so inspecting a repository does not disturb it; `LC_ALL=C` so a localised message cannot silently change a parse.

**External data — parsed, never asserted.** `src/parse/` returns discriminated results. There is no `as` assertion on external input anywhere in the codebase, and the lint configuration refuses object-literal type assertions to keep it that way.

**No network, no writes, no credentials.** The tool makes no outbound connection and writes nothing outside stdout and stderr. There is nothing for it to leak that it was not pointed at.

## Review performed for v1.0.0

Every subprocess and filesystem call site was reviewed against the rules above:

- `src/platform/process.ts` — the only `child_process` use in the codebase. `shell: false`, argument array, timeout, output cap.
- `src/platform/system.ts` — the only `node:fs` use outside `fswalk.ts`. Size cap enforced through the open handle; `lstat` rather than `stat`, so a symlink is never silently resolved.
- `src/platform/fswalk.ts` — `lstat` per entry; symlinked directories never entered; both bounds enforced inside the loop as well as around it.
- `src/core/project.ts` — the single place a user-supplied path is turned into a filesystem path.

`npm audit --omit=dev` reports **0 vulnerabilities**: there are no runtime dependencies to have any.

Development dependencies are a separate matter and are tracked honestly. See "Known issues" below.

## Known issues

**Development-dependency advisories.** The build toolchain (`vitest`, `typescript-eslint` and their transitive packages) carries open advisories at the time of release. They affect the test runner and linter on a developer's machine or in CI, **not** the shipped `dist/` output, which has no dependencies at all. Dependabot is enabled and these are updated as fixed versions become available. They are listed rather than suppressed, because an audit that is quiet for the wrong reason is worse than one that is noisy.

**The `.gitignore` matcher is an approximation.** `src/parse/gitignore.ts` implements the common pattern forms, not the whole of Git's ignore semantics. It affects only which files appear in a directory summary; nothing security-relevant depends on it, and the limitation is documented in the module itself.

**macOS and Windows are untested.** CI runs Linux only. The code avoids POSIX-specific behaviour, but the project does not claim platform support it has not verified.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

Security fixes land on the latest minor release of the current major.
