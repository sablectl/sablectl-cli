import { isAbsolute, relative, resolve } from 'node:path';
import { UsageError } from './errors.js';

/**
 * Resolves the `--path` option against the working directory and refuses
 * anything that escapes it.
 *
 * The containment rule is deliberate. This tool reads manifests and walks
 * directories, so a caller able to point it at an arbitrary path — in a
 * script, a CI job, or a `package.json` task someone else wrote — could use
 * it to read files outside the project. Refusing with a usage error costs a
 * legitimate user one `cd`; permitting it costs everyone a traversal
 * primitive.
 */
export function resolveProjectPath(
  cwd: string,
  requested: string | undefined,
): string {
  if (requested === undefined || requested === '') return resolve(cwd);

  const target = isAbsolute(requested)
    ? resolve(requested)
    : resolve(cwd, requested);

  const relation = relative(resolve(cwd), target);
  const escapes =
    relation.startsWith('..') ||
    (isAbsolute(relation) && relation !== resolve(cwd));

  if (escapes) {
    throw new UsageError(
      `--path must stay within the working directory (got '${requested}')`,
      'change directory to the project and run the command there instead',
    );
  }

  return target;
}
