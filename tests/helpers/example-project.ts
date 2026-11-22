import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ProjectFile } from '@/lib/format/types';

// The committed reference project (examples/product-test/testframe), read the way the store
// reads it. Gitignored files a running editor leaves behind (*.private.md, *.private.yaml,
// .testframebuild/) are never part of the reference project.

export const EXAMPLE_ROOT = path.resolve(import.meta.dir, '../../examples/product-test/testframe');

const isLocalOnly = (name: string): boolean =>
  name.endsWith('.private.md') || name.endsWith('.private.yaml') || name === '.gitignore';

function walk(dir: string, skip: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, skip));
    else if (e.isFile() && !isLocalOnly(e.name)) out.push(p);
  }
  return out;
}

/** Every committed `.md` file under a directory, paths relative to it, sorted by path. */
function list(dir: string): ProjectFile[] {
  return walk(dir)
    .filter((p) => p.endsWith('.md'))
    .sort()
    .map((p) => ({ path: path.relative(dir, p).split(path.sep).join('/'), content: readFileSync(p, 'utf8') }));
}

/** The reference project's frame files, paths relative to testframe/frames/. */
export const exampleFrames = (): ProjectFile[] => list(path.join(EXAMPLE_ROOT, 'frames'));

/** The reference project's sources*.yaml layers (file name -> text). */
export function exampleSourceLayers(): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of walk(EXAMPLE_ROOT).filter((f) => f.endsWith('.yaml')).sort()) out.set(path.basename(p), readFileSync(p, 'utf8'));
  return out;
}

/** Last modification of anything under the reference project (skipping the build cache). */
export function exampleLastModified(): Date {
  let latest = statSync(EXAMPLE_ROOT).mtimeMs;
  for (const p of walk(EXAMPLE_ROOT, ['.testframebuild'])) latest = Math.max(latest, statSync(p).mtimeMs);
  return new Date(latest);
}
