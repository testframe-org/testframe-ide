import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { ApiError } from '../format/errors';
import type { ProjectFile } from '../format/types';

// Storage of the projects under the projects root ({root}/{project}/testframe/...). Every path
// that comes from a request is validated here (security-sensitive, port of the Java
// ProjectFileStore): such a path goes through resolveRequestPath, which refuses `..` outright and
// then delegates to resolveUnder, the containment primitive (relative paths only, a character
// whitelist and a length cap, `..` stripped rather than followed, the result kept under its base
// directory, and no symlink anywhere below the projects root). Only `.md` files are written under
// frames/, the sources*.yaml layers only at the testframe/ root with their exact file-name
// grammar, the build cache only as `.json` files under testframe/.testframebuild/, and a replace
// scope can never be the frames/ root.

export const TESTFRAME_DIR = 'testframe';
export const FRAMES_DIR = 'testframe/frames';
export const BUILD_DIR = '.testframebuild';

/**
 * Largest project file (agents/specs/project-format.md, "File size"). A bigger one is reported and
 * skipped, never read — the same limit and the same message as the plugin's read-only
 * `ProjectDir.MAX_FILE_BYTES`, so both sides of the format agree on which files exist — and the
 * store never writes one: a save holding a bigger file is a 400 before anything is written (a
 * file saved over the limit would be skipped on the next load and pruned by the next save).
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** testframe/.gitignore, written by the IDE: private files and the build cache. */
export const GITIGNORE_LINES = ['*.private.md', '*.private.yaml', `${BUILD_DIR}/`];
const GITIGNORE_HEADER = '# Written by the TestFrame IDE: private data and the IDE build cache are never versioned';

const SAFE_PATH = /^[A-Za-z0-9 ._/\-À-ǿ]+$/;
const BUILD_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** An environment name segment: kebab-case, and `private` is reserved (agents/specs/project-format.md). */
const ENV_SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Recognizes the sources files at the `testframe/` root so they are READ and their name is
 * validated by the sources layer. Deliberately broader than {@link isSourceLayerFileName} (which
 * decides what may be WRITTEN): the spec makes "a `sources.{x}[.private].yaml` file whose `{x}`
 * is not in `environments`" and "any other `sources.*.yaml` file name" validation errors, and an
 * unread file can never be reported. Same grammar as the plugin's read-only decoder
 * (`ProjectDir.LAYER`), so both sides read the same set of files.
 */
const SOURCES_FILE_NAME = /^sources(\.[A-Za-z0-9_-]+)*\.yaml$/;

/** A project path is a name, not a document: these caps keep an oversized value off the disk. */
const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;

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

/** A rejected name inside an error message, truncated: an oversized value is never echoed back. */
const show = (value: string): string => (value.length > 120 ? `${value.slice(0, 120)}...` : value);

export class ProjectStore {
  readonly root: string;

  constructor(projectsRoot: string) {
    this.root = path.resolve(projectsRoot);
  }

  // ------------------------------------------------------------------ path validation

  /**
   * Resolves a name that came from a request (project, frame, card, scope, stale file) under
   * `baseDir`. Deny by default: a legitimate name never contains `..`, so it is rejected here
   * instead of being silently rewritten into something the caller did not ask for.
   */
  resolveRequestPath(relative: string | null | undefined, baseDir: string): string {
    if (typeof relative === 'string' && relative.includes('..')) throw bad(`Path traversal is not allowed: ${show(relative)}`);
    return this.resolveUnder(relative, baseDir);
  }

  /**
   * Containment primitive: resolves `relative` under `baseDir` and proves the result stays there.
   * Relative paths only, inside the length caps and the character whitelist; `..` is removed
   * (never followed), so a traversal attempt lands back inside the base; and no component below
   * the projects root may be a symlink. Lexical apart from `lstat`: a link is never followed to
   * decide where a write lands.
   */
  resolveUnder(relative: string | null | undefined, baseDir: string): string {
    if (relative === null || relative === undefined || relative.trim() === '') throw bad('Invalid project/file name');
    const trimmed = relative.trim();
    if (path.isAbsolute(trimmed)) throw bad(`Absolute paths are not allowed: ${show(trimmed)}`);
    if (trimmed.length > MAX_PATH_LENGTH || trimmed.split('/').some((s) => s.length > MAX_SEGMENT_LENGTH)) throw bad('Path is too long');
    const cleaned = trimmed.replaceAll('..', '').replace(/^\/+/, '');
    if (cleaned === '') throw bad('Invalid project/file name');
    if (!SAFE_PATH.test(cleaned)) throw bad(`Invalid character in path: ${show(trimmed)}`);
    const resolved = path.resolve(baseDir, cleaned);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) throw bad('Path outside the projects directory');
    this.assertNoSymlink(resolved);
    return resolved;
  }

  /**
   * Rejects a target reached through a symlink: every component of `target` below the projects
   * root must be a real entry, or a link planted inside a project would carry a write outside it
   * (the plugin reads with NOFOLLOW_LINKS; this is the write side of the same rule).
   */
  private assertNoSymlink(target: string): void {
    const relative = path.relative(this.root, target);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return;
    let current = this.root;
    for (const segment of relative.split(path.sep)) {
      if (segment === '') continue;
      current = path.join(current, segment);
      let stats;
      try {
        stats = lstatSync(current);
      } catch {
        return; // nothing on disk yet, so nothing to follow
      }
      if (stats.isSymbolicLink()) throw bad(`Symbolic links are not allowed in a project path: ${show(relative)}`);
    }
  }

  /** {root}/{project}: never the projects root itself. */
  projectDir(project: string | null | undefined): string {
    const dir = this.resolveRequestPath(project, this.root);
    if (dir === this.root) throw bad(`Invalid project name: ${show(project ?? '')}`);
    return dir;
  }

  testframeDir(project: string): string {
    return path.join(this.projectDir(project), TESTFRAME_DIR);
  }

  /** {root}/{project}/{subDir}: the sub-directory is validated like any request-supplied path. */
  private projectSubDir(project: string, subDir: string): string {
    return this.resolveRequestPath(subDir, this.projectDir(project));
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
    const dir = this.projectSubDir(project, subDir);
    const targets = new Map<string, string>();
    for (const file of files) {
      const target = this.resolveRequestPath(file.path, dir);
      if (!target.endsWith('.md')) throw bad(`Only .md files can be stored: ${show(file.path)}`);
      const content = file.content ?? '';
      checkSize(file.path, content);
      targets.set(target, content);
    }
    const scopeDirs: string[] = [];
    for (const scope of new Set(scopes)) {
      const scopeDir = this.resolveRequestPath(scope, dir);
      if (scopeDir === dir) throw bad(`Invalid scope: ${show(scope)}`);
      scopeDirs.push(scopeDir);
    }
    const stalePaths: string[] = [];
    for (const stale of new Set(staleFiles)) {
      const stalePath = this.resolveRequestPath(stale, dir);
      if (!stalePath.endsWith('.md')) throw bad(`Only .md files can be removed: ${show(stale)}`);
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

  /**
   * Every `.md` file under `subDir`, paths relative to it, sorted by path. A file over
   * {@link MAX_FILE_BYTES} is skipped and reported in `errors` instead of being read.
   */
  async list(project: string, subDir: string): Promise<{ files: ProjectFile[]; errors: string[] }> {
    const dir = this.projectSubDir(project, subDir);
    const paths = (await walkFiles(dir)).filter((p) => p.endsWith('.md')).sort();
    const read = await Promise.all(
      paths.map(async (p) => {
        const rel = path.relative(dir, p).split(path.sep).join('/');
        return { rel, content: await readCapped(p) };
      })
    );
    return {
      files: read.flatMap((r) => (r.content === null ? [] : [{ path: r.rel, content: r.content }])),
      errors: read.flatMap((r) => (r.content === null ? [oversizeProblem(r.rel)] : []))
    };
  }

  // ------------------------------------------------------------------ sources*.yaml layers

  /**
   * The sources*.yaml layer files at the testframe/ root (file name -> content), sorted by name. A
   * layer over {@link MAX_FILE_BYTES} is skipped and reported in `errors` instead of being read.
   */
  async readSourceLayers(project: string): Promise<{ layers: Map<string, string>; errors: string[] }> {
    const dir = this.testframeDir(project);
    const layers = new Map<string, string>();
    const errors: string[] = [];
    let names: string[];
    try {
      names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return { layers, errors };
    }
    for (const name of names.filter(isSourcesFileName).sort()) {
      const content = await readCapped(path.join(dir, name));
      if (content === null) errors.push(oversizeProblem(name));
      else layers.set(name, content);
    }
    return { layers, errors };
  }

  /** Writes the given layer files and deletes the `remove` ones (names validated first). */
  async writeSourceLayers(project: string, files: Map<string, string>, remove: string[]): Promise<SaveResult> {
    const dir = this.testframeDir(project);
    const check = (name: string) => {
      if (!isSourceLayerFileName(name)) throw bad(`Not a sources layer file name: ${show(name)}`);
      return this.resolveRequestPath(name, dir);
    };
    const targets = [...files].map(([name, content]) => {
      checkSize(name, content);
      return [check(name), content] as const;
    });
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

/**
 * Whether `name` is a sources file of the `testframe/` root, i.e. whether the store reads it as a
 * layer candidate. This is the RECOGNITION grammar, not the write grammar: it accepts every
 * `sources.{segment}...yaml` shape so that a bogus one is read and then reported by the sources
 * validation ("any other `sources.*.yaml` file name" is a validation error, and a file that is
 * never read can never be reported, deleted on save, or counted). Identical to the plugin's
 * read-only `ProjectDir.LAYER`, so both sides read the same files. It still rejects a path
 * (`sources.a/b.yaml`), an empty or non-whitelisted segment (`sources..yaml`, `sources.%2E.yaml`,
 * a null byte) and any other extension.
 */
export const isSourcesFileName = (name: string): boolean => SOURCES_FILE_NAME.test(name);

/**
 * Whether `name` is one of the four layer files the store may WRITE at the `testframe/` root
 * (agents/specs/project-format.md, "Sources"): `sources.yaml`, `sources.private.yaml`,
 * `sources.{env}.yaml`, `sources.{env}.private.yaml`, with `{env}` a kebab-case environment name
 * (`private` is reserved, so the two never overlap). Deny by default: any other shape is refused,
 * which keeps a write inside the `testframe/` root and keeps a secret-bearing `.private.yaml`
 * from being created under an arbitrary name.
 */
export function isSourceLayerFileName(name: string): boolean {
  if (!name.endsWith('.yaml')) return false;
  const parts = name.slice(0, -'.yaml'.length).split('.');
  if (parts[0] !== 'sources' || parts.length > 3) return false;
  const middle = parts.slice(1);
  if (middle.length === 0) return true; // sources.yaml
  if (middle.length === 1) return middle[0] === 'private' || isEnvSegment(middle[0]!); // sources.private.yaml | sources.{env}.yaml
  return middle[1] === 'private' && isEnvSegment(middle[0]!); // sources.{env}.private.yaml
}

const isEnvSegment = (segment: string): boolean => ENV_SEGMENT.test(segment) && segment !== 'private';

/** The problem reported for a file that was skipped for being over {@link MAX_FILE_BYTES}. */
const oversizeProblem = (rel: string): string => `${rel}: larger than ${MAX_FILE_BYTES} bytes, not read`;

/** Refuses (400) a file the store would not read back: over {@link MAX_FILE_BYTES} once encoded. */
function checkSize(rel: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw bad(`${show(rel)}: larger than ${MAX_FILE_BYTES} bytes, not written`);
  }
}

/** Reads a project file, or returns null when it is over {@link MAX_FILE_BYTES}. */
async function readCapped(file: string): Promise<string | null> {
  const { size } = await fs.stat(file);
  return size > MAX_FILE_BYTES ? null : fs.readFile(file, 'utf8');
}

/** Writes through a uniquely named temporary file (two concurrent saves never share one), then renames. */
async function writeAtomic(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
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
