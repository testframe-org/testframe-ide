import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { ApiError } from '../format/errors';
import type { ProjectFile } from '../format/types';

// Storage of the projects under the projects root ({root}/{project}/testframe/...). Every path
// that comes from a request is validated here (security-sensitive, port of the Java
// ProjectFileStore): `..` is stripped, a character whitelist applies, the resolved path must stay
// under its base directory, only `.md` files are written under frames/, the sources*.yaml layers
// only at the testframe/ root with their exact file-name grammar, the build cache only as `.json`
// files under testframe/.testframebuild/, and a replace scope can never be the frames/ root.

export const TESTFRAME_DIR = 'testframe';
export const FRAMES_DIR = 'testframe/frames';
export const BUILD_DIR = '.testframebuild';

/** testframe/.gitignore, written by the IDE: private files and the build cache. */
export const GITIGNORE_LINES = ['*.private.md', '*.private.yaml', `${BUILD_DIR}/`];
const GITIGNORE_HEADER = '# Written by the TestFrame IDE: private data and the IDE build cache are never versioned';

const SAFE_PATH = /^[A-Za-z0-9 ._/\-À-ǿ]+$/;
const SOURCE_LAYER = /^sources(\.[a-z0-9]+(-[a-z0-9]+)*)?(\.private)?\.yaml$/;
const BUILD_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface SaveResult {
  project: string;
  root: string;
  saved: number;
  removed: number;
}

export interface ProjectSummary {
  name: string;
  frames: number;
  sources: number;
  lastModified: string;
}

const bad = (message: string) => new ApiError(400, message);

export class ProjectStore {
  readonly root: string;

  constructor(projectsRoot: string) {
    this.root = path.resolve(projectsRoot);
  }

  // ------------------------------------------------------------------ path validation

  /** Resolves `relative` under `baseDir`: strips `..`, whitelists characters, stays inside. */
  resolveUnder(relative: string | null | undefined, baseDir: string): string {
    if (relative === null || relative === undefined || relative.trim() === '') throw bad('Invalid project/file name');
    const cleaned = relative.replaceAll('..', '').trim();
    if (!SAFE_PATH.test(cleaned)) throw bad(`Invalid character in path: ${relative}`);
    const resolved = path.resolve(baseDir, cleaned);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) throw bad('Path outside the projects directory');
    return resolved;
  }

  /** {root}/{project}: never the projects root itself. */
  projectDir(project: string | null | undefined): string {
    const dir = this.resolveUnder(project, this.root);
    if (dir === this.root) throw bad(`Invalid project name: ${project}`);
    return dir;
  }

  testframeDir(project: string): string {
    return path.join(this.projectDir(project), TESTFRAME_DIR);
  }

  // ------------------------------------------------------------------ .md files (frames)

  /**
   * Writes `files` (paths relative to `subDir`) and then deletes every other `.md` file inside
   * each of the `scopes` directories, so each scope ends up holding exactly what was sent. Scopes
   * are relative to `subDir` and must be strict sub-directories of it. `staleFiles` are single
   * files (outside the scopes) deleted unless they were sent. Every path is validated before
   * anything touches the disk.
   */
  async replace(project: string, subDir: string, scopes: string[], staleFiles: string[], files: ProjectFile[]): Promise<SaveResult> {
    const dir = path.join(this.projectDir(project), subDir);
    const targets = new Map<string, string>();
    for (const file of files) {
      const target = this.resolveUnder(file.path, dir);
      if (!target.endsWith('.md')) throw bad(`Only .md files can be stored: ${file.path}`);
      targets.set(target, file.content ?? '');
    }
    const scopeDirs: string[] = [];
    for (const scope of new Set(scopes)) {
      const scopeDir = this.resolveUnder(scope, dir);
      if (scopeDir === dir) throw bad(`Invalid scope: ${scope}`);
      scopeDirs.push(scopeDir);
    }
    const stalePaths: string[] = [];
    for (const stale of new Set(staleFiles)) {
      const stalePath = this.resolveUnder(stale, dir);
      if (!stalePath.endsWith('.md')) throw bad(`Only .md files can be removed: ${stale}`);
      stalePaths.push(stalePath);
    }

    for (const [target, content] of targets) await writeAtomic(target, content);
    let removed = 0;
    for (const scopeDir of scopeDirs) removed += await prune(scopeDir, new Set(targets.keys()));
    for (const stale of stalePaths) {
      if (!targets.has(stale) && (await deleteIfExists(stale))) removed++;
    }
    await this.ensureGitignore(project);
    return { project, root: dir, saved: targets.size, removed };
  }

  /** Every `.md` file under `subDir`, paths relative to it, sorted by path. */
  async list(project: string, subDir: string): Promise<ProjectFile[]> {
    const dir = path.join(this.projectDir(project), subDir);
    const paths = (await walkFiles(dir)).filter((p) => p.endsWith('.md')).sort();
    return Promise.all(
      paths.map(async (p) => ({ path: path.relative(dir, p).split(path.sep).join('/'), content: await fs.readFile(p, 'utf8') }))
    );
  }

  // ------------------------------------------------------------------ sources*.yaml layers

  /** The sources*.yaml layer files at the testframe/ root (file name -> content), sorted by name. */
  async readSourceLayers(project: string): Promise<Map<string, string>> {
    const dir = this.testframeDir(project);
    const out = new Map<string, string>();
    let names: string[];
    try {
      names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return out;
    }
    for (const name of names.filter(isSourcesFileName).sort()) out.set(name, await fs.readFile(path.join(dir, name), 'utf8'));
    return out;
  }

  /** Writes the given layer files and deletes the `remove` ones (names validated first). */
  async writeSourceLayers(project: string, files: Map<string, string>, remove: string[]): Promise<SaveResult> {
    const dir = this.testframeDir(project);
    const check = (name: string) => {
      if (!SOURCE_LAYER.test(name)) throw bad(`Not a sources layer file name: ${name}`);
      return this.resolveUnder(name, dir);
    };
    const targets = [...files].map(([name, content]) => [check(name), content] as const);
    const removals = remove.map(check);
    for (const [target, content] of targets) await writeAtomic(target, content);
    let removed = 0;
    for (const p of removals) if (!files.has(path.basename(p)) && (await deleteIfExists(p))) removed++;
    await this.ensureGitignore(project);
    return { project, root: dir, saved: targets.length, removed };
  }

  // ------------------------------------------------------------------ build cache (.testframebuild/)

  private buildPath(project: string, relative: string, json: boolean): string {
    const segments = relative.split('/');
    if (!segments.length || segments.some((s) => !BUILD_SEGMENT.test(s) || s.includes('..'))) {
      throw bad(`Invalid build cache path: ${relative}`);
    }
    if (json && !relative.endsWith('.json')) throw bad(`Build cache files are .json: ${relative}`);
    return this.resolveUnder(relative, path.join(this.testframeDir(project), BUILD_DIR));
  }

  async readBuild(project: string, relative: string): Promise<string | null> {
    try {
      return await fs.readFile(this.buildPath(project, relative, true), 'utf8');
    } catch (e) {
      if (e instanceof ApiError) throw e;
      return null;
    }
  }

  async writeBuild(project: string, relative: string, content: string): Promise<void> {
    await writeAtomic(this.buildPath(project, relative, true), content);
    await this.ensureGitignore(project);
  }

  async deleteBuild(project: string, relative: string): Promise<void> {
    const target = this.buildPath(project, relative, false);
    await fs.rm(target, { recursive: true, force: true });
  }

  /** Build cache files under `relativeDir` (paths relative to it, sorted). */
  async listBuild(project: string, relativeDir: string): Promise<string[]> {
    const dir = this.buildPath(project, relativeDir, false);
    return (await walkFiles(dir)).map((p) => path.relative(dir, p).split(path.sep).join('/')).sort();
  }

  /** Sub-directories of a build cache directory. */
  async listBuildDirs(project: string, relativeDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.buildPath(project, relativeDir, false), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      return [];
    }
  }

  // ------------------------------------------------------------------ .gitignore

  /** Makes sure testframe/.gitignore ignores the private files and the build cache. */
  async ensureGitignore(project: string): Promise<void> {
    const file = path.join(this.testframeDir(project), '.gitignore');
    const current = existsSync(file) ? await fs.readFile(file, 'utf8') : '';
    const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()));
    const missing = GITIGNORE_LINES.filter((l) => !lines.has(l));
    if (!missing.length) return;
    const prefix = current ? (current.endsWith('\n') ? current : `${current}\n`) : `${GITIGNORE_HEADER}\n`;
    await writeAtomic(file, prefix + missing.map((l) => `${l}\n`).join(''));
  }

  // ------------------------------------------------------------------ projects

  /** Every directory under the projects root that holds a testframe/ folder, most recent first. */
  async listProjects(countSources: (project: string) => Promise<number>): Promise<ProjectSummary[]> {
    let dirs: string[];
    try {
      dirs = (await fs.readdir(this.root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
    const projects: ProjectSummary[] = [];
    for (const name of dirs) {
      const testframe = path.join(this.root, name, TESTFRAME_DIR);
      if (!existsSync(testframe)) continue;
      let frames = 0;
      try {
        frames = (await fs.readdir(path.join(testframe, 'frames'), { withFileTypes: true })).filter((e) => e.isDirectory()).length;
      } catch {
        /* no frames yet */
      }
      let latest = (await fs.stat(testframe)).mtimeMs;
      for (const p of await walkFiles(testframe, [BUILD_DIR])) latest = Math.max(latest, (await fs.stat(p)).mtimeMs);
      projects.push({ name, frames, sources: await countSources(name), lastModified: new Date(latest).toISOString() });
    }
    return projects.sort((a, b) => (a.lastModified < b.lastModified ? 1 : a.lastModified > b.lastModified ? -1 : 0));
  }
}

/** `sources.yaml` and every `sources.*.yaml` (validated by the sources layer, not here). */
export const isSourcesFileName = (name: string): boolean => name === 'sources.yaml' || /^sources\..+\.yaml$/.test(name);

async function writeAtomic(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
}

async function deleteIfExists(file: string): Promise<boolean> {
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

/** Regular files under `dir` (recursive; `skip` names are not entered). */
async function walkFiles(dir: string, skip: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.includes(e.name)) out.push(...(await walkFiles(p, skip)));
    } else if (e.isFile()) out.push(p);
  }
  return out;
}

async function isEmptyDir(dir: string): Promise<boolean> {
  return (await fs.readdir(dir)).length === 0;
}

/** Deletes stale .md files under `scopeDir` (keeping `keep`) and the directories left empty. */
async function prune(scopeDir: string, keep: Set<string>): Promise<number> {
  if (!existsSync(scopeDir)) return 0;
  let removed = 0;
  const visit = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await visit(p);
        if (await isEmptyDir(p)) await fs.rmdir(p);
      } else if (e.isFile() && p.endsWith('.md') && !keep.has(p)) {
        await fs.unlink(p);
        removed++;
      }
    }
  };
  await visit(scopeDir);
  if (await isEmptyDir(scopeDir)) await fs.rmdir(scopeDir);
  return removed;
}
