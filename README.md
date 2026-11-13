# sablectl

**Sable Developer Toolkit** — diagnostics, validation and developer utilities for the command line.

`sablectl` answers four questions about a working directory, in under a second and without installing anything else: is this machine's toolchain usable, is this repository safe to walk away from, what is this project made of, and is its configuration internally consistent.

- **Zero runtime dependencies.** Node's standard library only. Nothing is pulled into a tool you run on your own machine.
- **Machine-readable.** Every command supports `--json` and documented exit codes, so CI can consume results rather than parse prose.
- **Quiet by default.** No animation, no spinner, no ASCII art. Colour is decoration; every status is also stated in words.

## Install

### From a release tarball

```sh
base=https://github.com/sablectl/sablectl-cli/releases/download/v1.0.0
curl -fsSLO "$base/sablectl-cli-v1.0.0.tar.gz"
curl -fsSLO "$base/sablectl-cli-v1.0.0.tar.gz.sha256"
sha256sum -c sablectl-cli-v1.0.0.tar.gz.sha256   # verify before extracting
tar -xzf sablectl-cli-v1.0.0.tar.gz
node sablectl-cli-v1.0.0/dist/bin/sablectl.js --version
```

Verify the checksum before you run anything. A tarball downloaded over the network is untrusted input until it has been checked against the SHA-256 published beside it. (A checksum proves integrity, not provenance — it defends against a corrupted or substituted download, not against a compromised release.)

To put it on `PATH`, link the binary:

```sh
ln -s "$PWD/sablectl-cli-v1.0.0/dist/bin/sablectl.js" ~/.local/bin/sablectl
```

### From source

```sh
git clone https://github.com/sablectl/sablectl-cli.git
cd sablectl-cli
npm ci
npm run build
node dist/bin/sablectl.js --help
```

**This package is not published to npm.** GitHub releases are the distribution channel. If you find a package by this name on a registry, it is not this project.

## Requirements

Node **20.19 or newer**. Developed and verified on Node 26.

CI runs on Linux across Node 20.19, 22 and 24. macOS and Windows are expected to work — the code uses `node:os` and `node:path` throughout and never shells out to POSIX utilities — but they are **not tested**, and that is a claim this project will not make until a runner proves it.

## Commands

### `sablectl doctor`

Everything below, in one report, ordered by severity so what needs attention comes first.

```text
$ sablectl doctor
sablectl doctor  v1.0.0

Environment
  PASS  Node.js
        v26.3.1 satisfies >=20.19
  …

Git
  WARN  Working tree
        0 staged, 2 unstaged, 1 untracked, 0 conflicted
        → Commit or stash before leaving this repository.
  …
```

### `sablectl env`

```text
$ sablectl env
sablectl env  v1.0.0

Environment
  INFO  Operating system
        Linux 7.2.15-300.fc45.x86_64 (linux)
  INFO  CPU
        x64, 12 logical cores
  INFO  Memory
        15 GiB total, 6.6 GiB free
  PASS  Node.js
        v26.3.1 satisfies >=20.19
  PASS  Package manager: npm
        v11.16.0
  INFO  Package manager: pnpm
        not installed
  INFO  Package manager: yarn
        not installed
  INFO  Package manager: bun
        not installed
  INFO  Shell
        /bin/bash
  INFO  Continuous integration
        detected via CI

2 pass, 8 info.
```

### `sablectl git`

Branch or detached HEAD, upstream divergence, working-tree counts, stash, last commit, and remotes **with embedded credentials redacted**.

```text
$ sablectl git
sablectl git  v1.0.0

Git
  PASS  Git version
        v2.56.0
  PASS  Repository
        inside a Git working tree
  INFO  Branch
        main
  INFO  Upstream
        no upstream configured for the current branch
  PASS  Working tree
        clean
  PASS  Stash
        empty
  INFO  Last commit
        7f3da9b 7 seconds ago — feat: sablectl CLI v1.0.0 — Sable Developer Toolkit
  INFO  Remotes
        none configured

4 pass, 4 info.
```

Outside a repository it says so and exits `1`. It does not print a stack trace: that is an answer, not a crash.

### `sablectl inspect`

```text
$ sablectl inspect
sablectl inspect  v1.0.0

Project
  INFO  Project type
        Node.js package, TypeScript
  INFO  Package manager
        npm (package-lock.json)
  INFO  Scripts
        9: build, check, format, format:check, lint, test, test:integration, test:watch, verify
  INFO  Dependencies
        0 runtime, 7 development, 0 peer
  INFO  Workspaces
        single package
  PASS  Test framework
        Vitest
  PASS  TypeScript configuration
        strict enabled, target ES2023
  INFO  Directory summary
        80 files in 20 directories

2 pass, 6 info.
```

The directory summary is bounded by depth and entry count, honours `.gitignore`, and **never follows symlinks** — which terminates on a link loop and refuses a link pointing outside the project.

### `sablectl validate`

```text
$ sablectl validate
sablectl validate  v1.0.0

Validation
  PASS  Manifest parses
        package.json is valid JSON
  PASS  Required manifest fields
        name 'sablectl', version '1.0.0'
  PASS  Version is semantic
        1.0.0
  PASS  Lockfile
        package-lock.json (npm)
  PASS  Dependency declarations
        no package appears in two dependency lists
  PASS  Node engine range
        running Node 26.3.1 satisfies '>=20.19'
  PASS  TypeScript strictness
        strict is enabled
  PASS  Referenced paths exist
        3 referenced path(s) present
  PASS  Publishable file list
        4 entries, none secret-shaped

9 pass.
```

`--strict` promotes warnings to failures, so exit `1` means "something needs attention" rather than only "something is broken".

## Exit codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| `0`  | Success; every check passed                                  |
| `1`  | One or more checks failed, or the command cannot run here    |
| `2`  | Usage error: unknown command, unknown flag, invalid argument |
| `3`  | Unexpected internal error (a defect — please report it)      |

## JSON output

```sh
sablectl validate --json | jq '.status, .summary'
```

The envelope is versioned independently of the tool, so a consumer can detect a breaking change without string-matching on the release number:

```json
{
  "schemaVersion": 1,
  "tool": "sablectl",
  "version": "1.0.0",
  "command": "validate",
  "generatedAt": "2026-11-12T16:40:00.000Z",
  "status": "pass",
  "summary": { "pass": 9, "warn": 0, "fail": 0, "info": 0, "skip": 0 },
  "sections": [{ "title": "Validation", "results": [] }]
}
```

## Configuration

There is no configuration file. Behaviour is controlled by flags and these environment variables:

| Variable      | Effect                                               |
| ------------- | ---------------------------------------------------- |
| `NO_COLOR`    | Any non-empty value disables colour                  |
| `FORCE_COLOR` | Re-enables colour even when stdout is not a terminal |
| `TERM=dumb`   | Disables colour                                      |

Precedence is `--no-color` → `NO_COLOR` → `TERM=dumb` → `FORCE_COLOR` → TTY detection. Piped output is monochrome by default, and monochrome output is byte-identical whichever of those suppressed it.

See [`docs/configuration.md`](docs/configuration.md) for detail, [`docs/commands.md`](docs/commands.md) for the full command reference, and [`docs/architecture.md`](docs/architecture.md) for how it is put together.

## Security

All subprocess execution uses `execFile` with an argument array and `shell: false`, so nothing derived from a branch name, directory name or remote URL is ever parsed by a shell. Remote URLs are redacted of embedded credentials before entering any output. `--path` is refused if it escapes the working directory. File reads are size-capped and directory traversal is bounded.

Full review and disclosure process: [`SECURITY.md`](SECURITY.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: `npm run verify` must pass, new behaviour needs a test that would fail without it, and runtime dependencies are not accepted.

## Licence and author

Released under the [MIT licence](LICENSE).

Written by Sable (<https://github.com/sablectl>) — <https://sablectl.dev>.
