import { lstat, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { WalkEntry, WalkOptions, WalkResult } from './types.js';

/**
 * Bounded, breadth-first, symlink-safe directory traversal.
 *
 * Symlinked directories are recorded but never entered. That single rule
 * closes two problems at once: a link pointing outside the project root
 * cannot be used to read elsewhere, and a self-referential loop cannot hang
 * the process. Depth and entry bounds guarantee termination regardless.
 */
export async function walk(
  root: string,
  options: WalkOptions,
): Promise<WalkResult> {
  const entries: WalkEntry[] = [];
  const skip = new Set(options.skipDirectories);
  let truncated = false;
  let symlinksSkipped = 0;

  const queue: { absolute: string; relative: string; depth: number }[] = [
    { absolute: root, relative: '', depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    if (entries.length >= options.maxEntries) {
      truncated = true;
      break;
    }

    let children: string[];
    try {
      children = await readdir(current.absolute);
    } catch {
      // Unreadable directory: reported by its absence rather than by a
      // crash. A permission error on one subtree must not abort the report.
      continue;
    }

    for (const name of [...children].sort()) {
      if (entries.length >= options.maxEntries) {
        truncated = true;
        break;
      }

      const absolute = join(current.absolute, name);
      const relative =
        current.relative === '' ? name : `${current.relative}/${name}`;

      let stats;
      try {
        stats = await lstat(absolute);
      } catch {
        continue;
      }

      if (stats.isSymbolicLink()) {
        symlinksSkipped += 1;
        entries.push({
          path: relative,
          kind: 'symlink',
          depth: current.depth,
          sizeBytes: 0,
        });
        continue;
      }

      if (stats.isDirectory()) {
        if (skip.has(name) || options.isIgnored?.(relative) === true) {
          continue;
        }
        entries.push({
          path: relative,
          kind: 'directory',
          depth: current.depth,
          sizeBytes: 0,
        });
        if (current.depth < options.maxDepth) {
          queue.push({ absolute, relative, depth: current.depth + 1 });
        } else {
          truncated = true;
        }
        continue;
      }

      if (options.isIgnored?.(relative) === true) continue;

      entries.push({
        path: relative,
        kind: stats.isFile() ? 'file' : 'other',
        depth: current.depth,
        sizeBytes: stats.isFile() ? stats.size : 0,
      });
    }
  }

  return { entries, truncated, symlinksSkipped };
}

/**
 * Normalises a path for display and comparison. Windows separators become
 * forward slashes so that reports, ignore rules and tests do not have to
 * care which platform produced the path.
 */
export function toPosixPath(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}
