# Configuration

There is no configuration file, and that is deliberate. A diagnostic tool whose behaviour depends on a file in the directory it is diagnosing can be told what to report by the thing it is reporting on. Everything here is controlled by flags and environment variables, both of which are visible in the command that produced the output.

## Environment variables

| Variable                            | Effect                                                            |
| ----------------------------------- | ----------------------------------------------------------------- |
| `NO_COLOR`                          | Any value other than empty or `0` disables colour                 |
| `FORCE_COLOR`                       | Any value other than empty or `0` enables colour, even when piped |
| `TERM=dumb`                         | Disables colour                                                   |
| `CI`, `GITHUB_ACTIONS`, and similar | Reported by `env` as CI detection; they do **not** change colour  |

### Colour precedence

1. `--no-color` — an explicit flag always wins.
2. `NO_COLOR` — the [no-color.org](https://no-color.org) convention.
3. `TERM=dumb`.
4. `FORCE_COLOR` — re-enables colour for a non-TTY, which is how a CI job gets coloured logs on purpose.
5. Otherwise colour follows TTY detection, so piped output is plain.

CI is deliberately **not** treated as a colour signal by itself. Many CI systems render ANSI correctly, and suppressing colour there by default would be guessing on the user's behalf; the TTY rule already covers the piped case.

Monochrome output is byte-identical whichever of these produced it. The test suite asserts that, because "mostly the same" output would make it impossible to diff two runs recorded under different conditions.

## Flags

See [`commands.md`](commands.md) for the full table. Two are worth explaining here.

### `--path <dir>`

Available on `inspect`, `validate` and `doctor`. It is resolved against the working directory and **refused if it escapes it**:

```text
$ sablectl inspect --path ../../etc
sablectl: --path must stay within the working directory (got '../../etc')
change directory to the project and run the command there instead
$ echo $?
2
```

The cost of the rule is one `cd` for a legitimate user. The cost of omitting it is that any script able to pass a flag to this tool gains a file-traversal primitive.

### `--strict`

Available on `validate` and `doctor`. It promotes every warning to a failure, so the exit code becomes `1` when anything at all needs attention. Use it in CI when you want warnings to block; leave it off when you want only genuine breakage to block.

## Bounds you cannot configure

These are fixed, because they exist to guarantee termination and bounded memory, and a configurable safety bound is one that will be configured away:

| Bound                       | Value                       |
| --------------------------- | --------------------------- |
| Subprocess timeout          | 5 s (10 s for `git status`) |
| Subprocess output cap       | 2 MiB                       |
| File read cap               | 1 MiB                       |
| Directory traversal depth   | 3 levels                    |
| Directory traversal entries | 2000                        |
| `exports` nesting depth     | 6 levels                    |

When a bound stops a traversal, the report says so rather than quietly reporting a partial result as complete.

## Exit codes

Exit codes are part of the interface and will not change within a major version: `0` success, `1` checks failed or the command cannot run here, `2` usage error, `3` internal error.

## JSON envelope

`schemaVersion` is versioned separately from the tool. A consumer should check it rather than the release number, because a patch release will never change the envelope and a future major might.
