import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from '@/lib/format/errors';
import { BUILD_DIR, FRAMES_DIR, GITIGNORE_LINES, ProjectStore, isSourcesFileName } from '@/lib/store/project-store';
import type { ProjectFile } from '@/lib/format/types';
import { tmpProject } from '../helpers/tmp-project';

// Port of server/src/test/java/com/testframe/server/store/ProjectFileStoreTest.java, extended for
// the sources*.yaml layers and the .testframebuild/ cache. Path validation is security-sensitive:
// every name that comes from a request goes through resolveUnder before anything touches the disk.

const file = (p: string, content = 'x'): ProjectFile => ({ path: p, content });

describe('project store: replace semantics', () => {
  test('a save removes stale cards only inside the saved frame', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main', 'other'], [], [
        file('main/step-1/a-card.md', 'a'),
        file('main/step-2/b-card.md', 'b'),
        file('other/step-1/c-card.md', 'c')
      ]);

      const result = await store.replace('demo', FRAMES_DIR, ['main'], [], [file('main/step-1/a-card.md', 'a2')]);
      expect(result.saved).toBe(1);
      expect(result.removed).toBe(1);
      expect(result.project).toBe('demo');

      const frames = path.join(tmp.testframeDir, 'frames');
      expect(readFileSync(path.join(frames, 'main/step-1/a-card.md'), 'utf8')).toBe('a2');
      expect(existsSync(path.join(frames, 'main/step-2'))).toBe(false);
      expect(existsSync(path.join(frames, 'other/step-1/c-card.md'))).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });

  test('an empty replace clears the scope', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [file('main/step-1/a-card.md', 'a')]);
      await store.replace('demo', FRAMES_DIR, ['main'], [], []);
      expect(existsSync(path.join(tmp.testframeDir, 'frames/main'))).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });

  test('private notes are pruned with their card', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [
        file('main/step-1/a-card.md', 'a'),
        file('main/step-1/a-card.private.md', 'secret')
      ]);
      await store.replace('demo', FRAMES_DIR, ['main'], [], []);
      expect(existsSync(path.join(tmp.testframeDir, 'frames/main/step-1/a-card.private.md'))).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });

  test('stale files outside the scopes are deleted unless they were sent', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [
        file('main/step-1/a.md', 'a'),
        file('main/step-1/b.md', 'b')
      ]);
      const result = await store.replace('demo', FRAMES_DIR, [], ['main/step-1/b.md', 'main/step-1/a.md'], [
        file('main/step-1/a.md', 'a2')
      ]);
      expect(result.removed).toBe(1);
      expect(result.saved).toBe(1);
      const frames = path.join(tmp.testframeDir, 'frames');
      expect(readFileSync(path.join(frames, 'main/step-1/a.md'), 'utf8')).toBe('a2');
      expect(existsSync(path.join(frames, 'main/step-1/b.md'))).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });

  test('list returns every .md file under a directory, sorted', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [
        file('main/step-2/b.md', 'b'),
        file('main/step-1/a.md', 'a'),
        file('main/step-1/a.private.md', 'secret')
      ]);
      const listed = await store.list('demo', FRAMES_DIR);
      expect(listed.map((f) => f.path)).toEqual([
        'main/step-1/a.md',
        'main/step-1/a.private.md',
        'main/step-2/b.md'
      ]);
      expect(listed[0]!.content).toBe('a');
      expect(await store.list('demo', 'testframe/nothing')).toEqual([]);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('project store: path sanitization', () => {
  const attempts = [
    ['../../etc/passwd.md', 'escapes the project'],
    ['../other/step-1/a.md', 'escapes into a sibling project'],
    ['main/step-1/../../../../etc/x.md', 'escapes through a deep path'],
    ['main/step-1/run.sh', 'not a .md file'],
    ['main/step-1/a.md.sh', 'not a .md file'],
    ['/etc/passwd.md', 'absolute path']
  ] as const;

  test('a traversal or non-markdown path is rejected and nothing is written', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      for (const [p] of attempts) {
        expect(async () => store.replace('demo', FRAMES_DIR, [], [], [file(p)])]).toThrow(ApiError);
      }
      expect(existsSync(path.join(tmp.root, 'demo/testframe/frames'))).toBe(false);
      expect(existsSync('/etc/passwd.md')).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });

  test('a scope can never be the frames root or escape it', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      for (const scope of ['.', '', '..', 'main/..']) {
        expect(async () => store.replace('demo', FRAMES_DIR, [scope], [], [])).toThrow(ApiError);
      }
      expect(async () => store.replace('demo', FRAMES_DIR, ['../other'], [], [])).toThrow(ApiError);
    } finally {
      tmp.cleanup();
    }
  });

  test('a project name cannot be the projects root or escape it', () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      expect(() => store.projectDir('')).toThrow(ApiError);
      expect(() => store.projectDir('   ')).toThrow(ApiError);
      expect(() => store.projectDir(null)).toThrow(ApiError);
      expect(() => store.projectDir('../etc')).toThrow(ApiError);
      expect(() => store.projectDir('a/b/../..')).toThrow(ApiError);
      expect(() => store.projectDir('de?mo')).toThrow(ApiError);
      expect(store.projectDir('demo')).toBe(path.join(tmp.root, 'demo'));
      expect(store.testframeDir('demo')).toBe(path.join(tmp.root, 'demo', 'testframe'));
    } finally {
      tmp.cleanup();
    }
  });

  test('resolveUnder strips .. and keeps the path inside its base', () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      const base = path.join(tmp.root, 'demo');
      expect(store.resolveUnder('a/b.md', base)).toBe(path.join(base, 'a/b.md'));
      // '..' is stripped, so a traversal attempt lands back inside the base
      expect(store.resolveUnder('../../etc/passwd.md', base)).toBe(path.join(base, 'etc/passwd.md'));
      expect(() => store.resolveUnder('a\u0000b.md', base)).toThrow(ApiError);
      expect(() => store.resolveUnder('', base)).toThrow(ApiError);
    } finally {
      tmp.cleanup();
    }
  });

  test('a stale file name is validated too', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      expect(async () => store.replace('demo', FRAMES_DIR, [], ['main/step-1/run.sh'], [])).toThrow(ApiError);
      expect(async () => store.replace('demo', FRAMES_DIR, [], ['../../etc/passwd.md'], [])).toThrow(ApiError);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('project store: sources*.yaml layers', () => {
  test('only layer file names are accepted, at the testframe root', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.writeSourceLayers(
        'demo',
        new Map([
          ['sources.yaml', 'environments: [local]\n'],
          ['sources.local.private.yaml', 'openapi: {}\n']
        ]),
        []
      );
      expect(tmp.read('sources.yaml')).toBe('environments: [local]\n');
      expect(tmp.read('sources.local.private.yaml')).toBe('openapi: {}\n');

      for (const name of ['../sources.yaml', 'sources.local.yaml/x', 'frames/sources.yaml', 'other.yaml', 'sources.yml']) {
        expect(async () => store.writeSourceLayers('demo', new Map([[name, 'x']]), [])).toThrow(ApiError);
      }
      expect(async () => store.writeSourceLayers('demo', new Map(), ['../../etc/passwd.yaml'])).toThrow(ApiError);
    } finally {
      tmp.cleanup();
    }
  });

  test('a save rewrites the sent layers and deletes the removed ones', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.writeSourceLayers(
        'demo',
        new Map([
          ['sources.yaml', 'a'],
          ['sources.private.yaml', 'b'],
          ['sources.hml.yaml', 'c']
        ]),
        []
      );
      const result = await store.writeSourceLayers('demo', new Map([['sources.yaml', 'a2']]), [
        'sources.private.yaml',
        'sources.hml.yaml'
      ]);
      expect(result.saved).toBe(1);
      expect(result.removed).toBe(2);
      expect(tmp.read('sources.yaml')).toBe('a2');
      expect(existsSync(path.join(tmp.testframeDir, 'sources.private.yaml'))).toBe(false);
      expect(existsSync(path.join(tmp.testframeDir, 'sources.hml.yaml'))).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });

  test('readSourceLayers returns the layers on disk, sorted', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      tmp.write('sources.yaml', 'base');
      tmp.write('sources.local.yaml', 'local');
      tmp.write('sources.private.yaml', 'private');
      tmp.write('not-a-layer.yaml', 'ignored');
      const layers = await store.readSourceLayers('demo');
      expect([...layers.keys()]).toEqual(['sources.local.yaml', 'sources.private.yaml', 'sources.yaml']);
      expect(layers.get('sources.yaml')).toBe('base');
      expect(await store.readSourceLayers('missing-project')).toEqual(new Map());
    } finally {
      tmp.cleanup();
    }
  });

  test('isSourcesFileName matches every layer and nothing else', () => {
    expect(isSourcesFileName('sources.yaml')).toBe(true);
    expect(isSourcesFileName('sources.private.yaml')).toBe(true);
    expect(isSourcesFileName('sources.hml-1.private.yaml')).toBe(true);
    expect(isSourcesFileName('sources.other.yaml')).toBe(false);
    expect(isSourcesFileName('settings.yaml')).toBe(false);
  });
});

describe('project store: .testframebuild cache', () => {
  test('writes, reads, lists and deletes cache files', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.writeBuild('demo', 'runs/local/main/step-1/a.json', '{"status":"success"}');
      await store.writeBuild('demo', 'openapi/local/product-api.json', '{"operations":[]}');
      expect(await store.readBuild('demo', 'runs/local/main/step-1/a.json')).toBe('{"status":"success"}');
      expect(await store.readBuild('demo', 'runs/local/main/step-1/missing.json')).toBeNull();
      expect(await store.listBuild('demo', 'runs/local/main/step-1')).toEqual(['a.json']);
      expect(await store.listBuildDirs('demo', 'runs')).toEqual(['local']);
      expect(await store.listBuildDirs('demo', 'runs/nope')).toEqual([]);

      await store.deleteBuild('demo', 'runs/local');
      expect(await store.listBuildDirs('demo', 'runs')).toEqual([]);
      expect(existsSync(path.join(tmp.testframeDir, BUILD_DIR, 'openapi/local/product-api.json'))).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });

  test('cache paths are validated', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      for (const relative of ['../../etc/passwd.json', 'runs/../x.json', 'runs/a.txt', '', '.hidden/x.json']) {
        expect(async () => store.writeBuild('demo', relative, '{}')).toThrow(ApiError);
      }
      expect(async () => store.readBuild('demo', '../sources.yaml')).toThrow(ApiError);
      expect(await store.readBuild('demo', 'runs/missing.json')).toBeNull();
    } finally {
      tmp.cleanup();
    }
  });

  test('the cache lives under testframe/.testframebuild', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.writeBuild('demo', 'runs/local/a.json', '{}');
      expect(existsSync(path.join(tmp.testframeDir, '.testframebuild/runs/local/a.json'))).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('project store: testframe/.gitignore', () => {
  test('is written once with the private files and the build cache', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [file('main/step-1/a.md', 'a')]);
      const gitignore = tmp.read('.gitignore');
      for (const line of GITIGNORE_LINES) expect(gitignore.split('\n')).toContain(line);
      expect(GITIGNORE_LINES).toEqual(['*.private.md', '*.private.yaml', '.testframebuild/']);

      const before = gitignore;
      await store.replace('demo', FRAMES_DIR, ['main'], [], [file('main/step-1/a.md', 'a2')]);
      expect(tmp.read('.gitignore')).toBe(before);
    } finally {
      tmp.cleanup();
    }
  });

  test('keeps what the user already ignored and adds only what is missing', async () => {
    const tmp = tmpProject();
    try {
      tmp.write('.gitignore', '*.private.md\nnode_modules/\n');
      const store = new ProjectStore(tmp.root);
      await store.ensureGitignore('demo');
      const lines = tmp.read('.gitignore').split('\n');
      expect(lines).toContain('node_modules/');
      expect(lines).toContain('*.private.yaml');
      expect(lines).toContain('.testframebuild/');
      expect(lines.filter((l) => l === '*.private.md').length).toBe(1);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('project store: project listing', () => {
  test('lists the directories that hold a testframe folder, with counts', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main', 'other'], [], [
        file('main/step-1/a.md', 'a'),
        file('other/step-1/b.md', 'b')
      ]);
      await store.writeSourceLayers(
        'demo',
        new Map([['sources.yaml', 'environments: [local]\nmongo:\n  db:\n    base-url: mongodb://x\n']]),
        []
      );
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.join(tmp.root, 'not-a-project'), { recursive: true });

      const projects = await store.listProjects(async () => 1);
      expect(projects.length).toBe(1);
      expect(projects[0]!.name).toBe('demo');
      expect(projects[0]!.frames).toBe(2);
      expect(projects[0]!.sources).toBe(1);
      expect(Date.parse(projects[0]!.lastModified)).not.toBeNaN();
    } finally {
      tmp.cleanup();
    }
  });

  test('an unreadable projects root lists nothing', async () => {
    const store = new ProjectStore(path.join(tmpProject().root, 'missing'));
    expect(await store.listProjects(async () => 0)).toEqual([]);
  });

  test('the most recently changed project comes first', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('old', FRAMES_DIR, ['main'], [], [file('main/step-1/a.md', 'a')]);
      await new Promise((r) => setTimeout(r, 15));
      await store.replace('new', FRAMES_DIR, ['main'], [], [file('main/step-1/a.md', 'a')]);
      const names = (await store.listProjects(async () => 0)).map((p) => p.name);
      expect(names[0]).toBe('new');
    } finally {
      tmp.cleanup();
    }
  });
});
