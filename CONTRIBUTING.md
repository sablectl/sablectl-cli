# Contributing

Thank you for considering it. This document is short because the rules are few, and each one exists for a reason that is stated.

## Getting set up

```sh
git clone https://github.com/sablectl/sablectl-cli.git
cd sablectl-cli
npm ci
npm run verify
```

`npm run verify` runs the whole gate: type check, lint, format check, unit tests, integration tests and the build. It must pass before a pull request is opened and it runs again in CI.

| Script                      | Does                                     |
| --------------------------- | ---------------------------------------- |
| `npm run check`             | `tsc --noEmit` against the strict config |
| `npm run lint`              | ESLint, type-aware                       |
| `npm run format` / `:check` | Prettier                                 |
| `npm test`                  | Unit tests                               |
| `npm run test:integration`  | Integration tests (real temp fixtures)   |
| `npm run build`             | Compile to `dist/`                       |

## The three rules

**1. No runtime dependencies.** This is not a stylistic preference. People run this tool on their own machines, often against a project they do not yet trust, and every dependency widens the supply chain they are implicitly accepting. A pull request adding one to `dependencies` will be declined regardless of how useful the package is. Development dependencies are fine.

**2. New behaviour needs a test that fails without it.** Write the test first, watch it fail, then make it pass. A test added afterwards that has never failed proves only that the code runs.

**3. Assert on outcomes, not on calls.** Check statuses, exit codes, emitted strings and JSON shapes. Do not assert that an internal function was invoked: that couples the test to the implementation and keeps passing after the behaviour breaks.

## Adding a check

Checks are the unit of functionality. To add one:

1. Write a function returning a `CheckResult` with a stable `id` (`area.thing`), a status, a one-line `summary` that reads correctly without colour, and a `remediation` whenever the status is `warn` or `fail`.
2. Add it to the relevant `collect*Checks` function. It will appear in `doctor` automatically.
3. Unit-test it against a fake `SystemAccess`. Never reach for the real filesystem in a unit test.

A check that cannot tell the user what to do about a failure is incomplete. "Something is wrong" is not a diagnostic.

## Adding a command

Add a `CommandDefinition` and register it in `src/core/registry.ts`. Help output is generated from the registry, so documentation cannot drift; a test derives the expected command list from the same source, so an undocumented command fails the suite.

## Touching the platform layer

`src/platform/` is the only place allowed to call the operating system. Two rules hold there without exception:

- **`execFile` with an argument array, never `exec` and never `shell: true`.** This is what makes command injection structurally impossible rather than something a filter must anticipate.
- **Every unbounded thing gets a bound.** Reads are size-capped, subprocesses have timeouts and output caps, traversal has depth and entry limits. If a bound is reached, the output must say so rather than present a partial result as complete.

## Style

Prettier decides formatting; do not argue with it in review. Comments should explain _why_, not restate the code — the existing source is the reference for tone and density.

## Commits

Write a descriptive subject line in the imperative mood. Author and committer must be your own identity. Do not add generated-by notices or tool-attribution trailers; a commit records who is accountable for a change, not which editor produced it. Genuine human co-authors get a real `Co-authored-by` line, added deliberately.

## Security issues

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).
