import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServices, type Services } from '@/lib/services/context';
import type { Fetcher } from '@/lib/openapi/openapi-service';

// Scratch projects root for the store/service tests: every test gets its own temporary
// directory and its own services, so nothing leaks between them.

export interface TmpProject {
  /** The projects root ({root}/{project}/testframe/...). */
  root: string;
  /** {root}/{project}/testframe. */
  testframeDir: string;
  services: Services;
  /** Reads a file under the project's testframe/ directory. */
  read: (relative: string) => string;
  /** Whether a path under the project's testframe/ directory exists. */
  exists: (relative: string) => boolean;
  /** Writes a file under the project's testframe/ directory (parents created). */
  write: (relative: string, content: string) => void;
  /** Names inside a directory under the project's testframe/ directory. */
  names: (relative: string) => string[];
  /** Deletes the temporary root. */
  cleanup: () => void;
}

export function tmpProject(project = 'demo', fetcher?: Fetcher): TmpProject {
  const root = mkdtempSync(path.join(tmpdir(), 'testframe-projects-'));
  const testframeDir = path.join(root, project, 'testframe');
  mkdirSync(testframeDir, { recursive: true });
  const services = createServices(root, 'http://runner.invalid', undefined, fetcher);
  return {
    root,
    testframeDir,
    services,
    read: (relative) => readFileSync(path.join(testframeDir, relative), 'utf8'),
    exists: (relative) => {
      try {
        readFileSync(path.join(testframeDir, relative));
        return true;
      } catch {
        return readdirSync(path.join(testframeDir, relative)).length >= 0;
      }
    },
    write: (relative, content) => {
      const target = path.join(testframeDir, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    },
    names: (relative) => readdirSync(path.join(testframeDir, relative)).sort(),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

/** Writes the sources*.yaml layers of a project straight to disk (bypassing validation). */
export function writeLayers(tmp: TmpProject, layers: Record<string, string>): void {
  for (const [name, content] of Object.entries(layers)) tmp.write(name, content);
}
