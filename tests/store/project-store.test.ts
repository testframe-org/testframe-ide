import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApiError } from '@/lib/format/errors';
import {
  BUILD_DIR,
  FRAMES_DIR,
  GITIGNORE_LINES,
  MAX_FILE_BYTES,
  ProjectStore,
  isSourceLayerFileName,
  isSourcesFileName
} from '@/lib/store/project-store';
import { classify, readModel } from '@/lib/sources/sources-yaml';
import type { ProjectFile } from '@/lib/format/types';
import { tmpProject } from '../helpers/tmp-project';

// Port of server/src/test/java/com/testframe/server/store/ProjectFileStoreTest.java, extended for
// the sources*.yaml layers and the .testframebuild/ cache. Path validation is security-sensitive:
// every name that comes from a request goes through resolveRequestPath (which refuses `..` and
// absolute paths) and then resolveUnder (character whitelist, length cap, containment, no symlink)
// before anything touches the disk.

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
      const { files: listed, errors } = await store.list('demo', FRAMES_DIR);
      expect(errors).toEqual([]);
      expect(listed.map((f) => f.path)).toEqual([
        'main/step-1/a.md',
        'main/step-1/a.private.md',
        'main/step-2/b.md'
      ]);
      expect(listed[0]!.content).toBe('a');
      expect(await store.list('demo', 'testframe/nothing')).toEqual({ files: [], errors: [] });
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
        expect(async () => store.replace('demo', FRAMES_DIR, [], [], [file(p)])).toThrow(ApiError);
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

  test('an absolute path is rejected, never resolved against the base', () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      const base = path.join(tmp.root, 'demo');
      for (const p of ['/etc/passwd.md', '/', '//etc/passwd.md', '/tmp/x.md']) {
        expect(() => store.resolveUnder(p, base)).toThrow(ApiError);
      }
      // the sub-directory of a save/list is a request path too
      expect(async () => store.replace('demo', '/etc', [], [], [file('passwd.md')])).toThrow(ApiError);
      expect(async () => store.replace('demo', '../elsewhere', [], [], [file('a.md')])).toThrow(ApiError);
      expect(async () => store.list('demo', '../other')).toThrow(ApiError);
    } finally {
      tmp.cleanup();
    }
  });

  test('resolveRequestPath rejects .. that resolveUnder would only strip', () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      const base = path.join(tmp.root, 'demo');
      const traversal = 'main/step-1/a.md/../../../../etc/x.md';
      // resolveUnder is the containment primitive: '..' is removed, so the result stays inside
      expect(store.resolveUnder(traversal, base)).toBe(path.join(base, 'main/step-1/a.md/etc/x.md'));
      // the boundary a request goes through refuses it instead of rewriting it
      for (const p of [traversal, '..', '../etc', 'main/..', 'a/..', '..']) {
        expect(() => store.resolveRequestPath(p, base)).toThrow(ApiError);
      }
      expect(store.resolveRequestPath('main/step-1/a.md', base)).toBe(path.join(base, 'main/step-1/a.md'));
    } finally {
      tmp.cleanup();
    }
  });

  test('an encoded separator or traversal is never decoded into a path', () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      const base = path.join(tmp.root, 'demo');
      for (const p of [
        '..%2F..%2Fetc%2Fpasswd.md',
        '%2e%2e/etc/passwd.md',
        'main%2fstep-1%2fa.md',
        'main/step-1/a%00.md',
        'main\\step-1\\a.md',
        'main/step-1/a\u0000.md'
      ]) {
        expect(() => store.resolveUnder(p, base)).toThrow(ApiError);
      }
      // the character whitelist also holds for a sources layer name and a build cache path
      expect(isSourcesFileName('sources.%2Eprivate.yaml')).toBe(false);
      expect(async () => store.writeBuild('demo', 'runs/a%2E%2E/b.json', '{}')).toThrow(ApiError);
    } finally {
      tmp.cleanup();
    }
  });

  test('an oversized name is rejected and is not echoed back whole', () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      const base = path.join(tmp.root, 'demo');
      // a segment over NAME_MAX and a path over the cap never reach the disk
      expect(() => store.resolveUnder(`${'a'.repeat(300)}.md`, base)).toThrow('Path is too long');
      expect(() => store.resolveUnder(`${'a/'.repeat(600)}x.md`, base)).toThrow('Path is too long');
      expect(() => store.resolveUnder(`${'a'.repeat(5000)}.md`, base)).toThrow('Path is too long');

      // a rejected name is echoed truncated, so an oversized value is not amplified into the 400
      const long = `${'a'.repeat(200)}?.md`;
      let message = '';
      try {
        store.resolveUnder(long, base);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        message = (e as ApiError).message;
      }
      expect(message).toContain('Invalid character in path');
      expect(message.length).toBeLessThan(long.length);
      expect(message.endsWith('...')).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });

  test('a symlink inside a project cannot carry a write outside it', async () => {
    const tmp = tmpProject();
    const outside = mkdtempSync(path.join(tmpdir(), 'testframe-outside-'));
    try {
      const store = new ProjectStore(tmp.root);
      const frames = path.join(tmp.testframeDir, 'frames');
      mkdirSync(path.join(frames, 'main/step-1'), { recursive: true });
      symlinkSync(outside, path.join(frames, 'main/step-1/escape'));

      // resolveUnder is lexical, so the escape is caught by the symlink check, not by containment
      expect(() => store.resolveUnder('main/step-1/escape/pwned.md', frames)).toThrow(ApiError);
      expect(async () => store.replace('demo', FRAMES_DIR, ['main'], [], [file('main/step-1/escape/pwned.md')])).toThrow(ApiError);
      expect(async () => store.replace('demo', FRAMES_DIR, ['main/step-1/escape'], [], [])).toThrow(ApiError);
      expect(existsSync(path.join(outside, 'pwned.md'))).toBe(false);

      // a symlinked project folder is refused too (the plugin reads with NOFOLLOW_LINKS)
      symlinkSync(outside, path.join(tmp.root, 'linked'));
      expect(() => store.projectDir('linked')).toThrow(ApiError);
      // a symlink is not a regular file, so it is never read back as a sources layer
      symlinkSync(path.join(outside, 'sources.yaml'), path.join(tmp.testframeDir, 'sources.yaml'));
      expect((await store.readSourceLayers('demo')).layers.has('sources.yaml')).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      tmp.cleanup();
    }
  });

  test('a symlink planted between the path check and the write is refused too (TOCTOU)', async () => {
    const tmp = tmpProject();
    const outside = mkdtempSync(path.join(tmpdir(), 'testframe-outside-'));
    try {
      const store = new ProjectStore(tmp.root);
      const frames = path.join(tmp.testframeDir, 'frames');
      mkdirSync(path.join(frames, 'main/step-1'), { recursive: true });
      const link = path.join(frames, 'main/step-1/escape');

      // `escape` does not exist while the paths are validated, so the symlink check has nothing to
      // see there. A card's content is the last thing the validation loop reads, so this getter is
      // the window a concurrent writer gets: every path is checked already, nothing is written yet.
      const planted: ProjectFile = {
        path: 'main/step-1/escape/pwned.md',
        get content() {
          if (!existsSync(link)) symlinkSync(outside, link);
          return 'p';
        }
      };
      await expect(
        store.replace('demo', FRAMES_DIR, ['main'], [], [file('main/step-1/a.md', 'a'), planted])
      ).rejects.toThrow(ApiError);
      expect(existsSync(path.join(outside, 'pwned.md'))).toBe(false);
      // the file validated before the link appeared is written, and no .tmp is left behind
      expect(readFileSync(path.join(frames, 'main/step-1/a.md'), 'utf8')).toBe('a');
      expect(readdirSync(path.join(frames, 'main/step-1')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      tmp.cleanup();
    }
  });

  test('Windows and UNC paths are rejected on every platform', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      const base = path.join(tmp.root, 'demo');
      // A drive letter or a UNC share is absolute on Windows and carries a `:` or a `\`, which the
      // character whitelist refuses everywhere — so neither platform resolves one against the base.
      const attempts = [
        'C:\\x\\pwned.md',
        'C:\\',
        'C:x.md',
        'c:/x/pwned.md',
        '\\\\server\\share\\pwned.md',
        '\\\\?\\C:\\x\\pwned.md',
        '\\\\localhost\\c$\\x.md',
        'main\\step-1\\a.md'
      ];
      for (const p of attempts) {
        expect(() => store.resolveUnder(p, base)).toThrow(ApiError);
        expect(() => store.resolveRequestPath(p, base)).toThrow(ApiError);
      }

      // the same rule holds for a project name, a sources layer name and a build cache path
      for (const p of ['C:\\x', '\\\\server\\share', 'c:/x']) expect(() => store.projectDir(p)).toThrow(ApiError);
      for (const name of ['sources.C:\\x.yaml', 'sources.a\\b.yaml', '\\\\server\\share\\sources.yaml']) {
        expect(isSourcesFileName(name)).toBe(false);
        expect(isSourceLayerFileName(name)).toBe(false);
      }
      expect(async () => store.writeBuild('demo', 'runs\\local\\a.json', '{}')).toThrow(ApiError);

      // and a save carrying one writes nothing at all
      await expect(store.replace('demo', FRAMES_DIR, [], [], [file('main\\step-1\\a.md')])).rejects.toThrow(ApiError);
      expect(existsSync(path.join(tmp.testframeDir, 'frames'))).toBe(false);
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
      const { layers, errors } = await store.readSourceLayers('demo');
      expect(errors).toEqual([]);
      expect([...layers.keys()]).toEqual(['sources.local.yaml', 'sources.private.yaml', 'sources.yaml']);
      expect(layers.get('sources.yaml')).toBe('base');
      expect(await store.readSourceLayers('missing-project')).toEqual({ layers: new Map(), errors: [] });
    } finally {
      tmp.cleanup();
    }
  });

  test('a file over MAX_FILE_BYTES is reported, not read (parity with the plugin decoder)', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      const huge = `environments: [local]\n# ${'x'.repeat(MAX_FILE_BYTES)}`;
      tmp.write('sources.yaml', 'environments: [local]\n');
      tmp.write('sources.local.yaml', huge);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [
        file('main/step-1/flow.md', 'small\nbig'),
        file('main/step-1/small.md', 'tiny')
      ]);
      // the store refuses to write an oversized file, so it is planted on disk directly
      tmp.write('frames/main/step-1/big.md', huge);

      // the oversized layer is skipped and named in errors; the readable one still comes through
      const layers = await store.readSourceLayers('demo');
      expect([...layers.layers.keys()]).toEqual(['sources.yaml']);
      expect(layers.errors).toEqual([`sources.local.yaml: larger than ${MAX_FILE_BYTES} bytes, not read`]);

      // the oversized card is skipped the same way, and the rest of the frame is untouched
      const listed = await store.list('demo', FRAMES_DIR);
      expect(listed.files.map((f) => f.path)).toEqual(['main/step-1/flow.md', 'main/step-1/small.md']);
      expect(listed.errors).toEqual([`main/step-1/big.md: larger than ${MAX_FILE_BYTES} bytes, not read`]);

      // exactly at the limit is still read
      tmp.write('sources.dev.yaml', 'x'.repeat(MAX_FILE_BYTES));
      const atLimit = await store.readSourceLayers('demo');
      expect([...atLimit.layers.keys()]).toContain('sources.dev.yaml');
      expect(atLimit.errors).toEqual([`sources.local.yaml: larger than ${MAX_FILE_BYTES} bytes, not read`]);
    } finally {
      tmp.cleanup();
    }
  });

  test('isSourcesFileName recognizes every sources*.yaml name, so a bogus one can be reported', () => {
    // the four canonical layers
    for (const name of ['sources.yaml', 'sources.private.yaml', 'sources.hml.yaml', 'sources.hml-1.private.yaml']) {
      expect(isSourcesFileName(name)).toBe(true);
    }
    // Recognized (read) but not a valid layer. This is the recognition grammar, not the write
    // grammar: agents/specs/project-format.md ("Sources" > Validation) makes both "a sources.{x}
    // [.private].yaml file whose {x} is not in environments" and "any other sources.*.yaml file
    // name" errors reported in `errors`, and a file that is never read can never be reported,
    // counted, or deleted on save. `other` and `local` are the same shape, and sources.local.yaml
    // has to be read (see "readSourceLayers returns the layers on disk"). Same grammar as the
    // plugin's read-only ProjectDir.LAYER, so both sides read the same files.
    expect(isSourcesFileName('sources.other.yaml')).toBe(true);
    expect(isSourcesFileName('sources.yaml.yaml')).toBe(true);
    expect(isSourcesFileName('sources.a.b.yaml')).toBe(true);
    // not a sources file at all
    for (const name of ['settings.yaml', 'sources.yml', 'sources', 'not-a-layer.yaml', 'sources.yaml.md', '']) {
      expect(isSourcesFileName(name)).toBe(false);
    }
    // attack cases: a path, an empty segment, an encoded separator, a null byte
    for (const name of [
      '../sources.yaml',
      'sources.a/b.yaml',
      'sources..yaml',
      'sources.%2Eyaml',
      'sources\u0000.yaml',
      'sources.private.yaml/x',
      'sources.local.yaml.bak'
    ]) {
      expect(isSourcesFileName(name)).toBe(false);
    }
  });

  test('isSourceLayerFileName accepts only the four writable layers', () => {
    for (const name of ['sources.yaml', 'sources.private.yaml', 'sources.local.yaml', 'sources.hml-1.private.yaml']) {
      expect(isSourceLayerFileName(name)).toBe(true);
    }
    for (const name of [
      // a reserved or malformed {env}
      'sources.private.private.yaml',
      'sources.Local.yaml',
      'sources.local.PRIVATE.yaml',
      'sources.a_b.yaml',
      'sources.-local.yaml',
      'sources.local-.yaml',
      'sources..yaml',
      'sources.yaml.yaml.yaml',
      // not at the testframe/ root, not a layer, not a name
      '../sources.yaml',
      'sources.a/b.yaml',
      'frames/sources.yaml',
      'sources.yml',
      'other.yaml',
      'sources.yaml/x',
      'sources\u0000.yaml',
      'sources.%2Eprivate.yaml',
      ''
    ]) {
      expect(isSourceLayerFileName(name)).toBe(false);
    }
  });

  test('a bogus sources file is read, reported and dropped on save', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      tmp.write('sources.yaml', 'environments: [local]\n');
      tmp.write('sources.other.yaml', 'openapi: {}\n');
      tmp.write('sources.a.b.yaml', 'openapi: {}\n');
      tmp.write('settings.yaml', 'openapi: {}\n');

      const { layers } = await store.readSourceLayers('demo');
      expect([...layers.keys()]).toEqual(['sources.a.b.yaml', 'sources.other.yaml', 'sources.yaml']);

      // a recognized-but-invalid name surfaces as a validation error instead of being ignored
      const { errors } = readModel(layers);
      expect(errors).toContain('sources.other.yaml: environment "other" is not in the environments list of sources.yaml');
      expect(errors.some((e) => e.startsWith('sources.a.b.yaml: not a sources layer'))).toBe(true);
      // ...and is classified, so a sources save deletes it instead of leaving it behind
      expect(classify('sources.other.yaml')).toEqual({ kind: 'env', env: 'other', isPrivate: false });

      // the write side stays narrow: a bogus name is refused, it is never created at the root
      expect(async () => store.writeSourceLayers('demo', new Map([['sources.other.private.private.yaml', 'x']]), [])).toThrow(ApiError);
      expect(existsSync(path.join(tmp.testframeDir, 'sources.other.private.private.yaml'))).toBe(false);
      expect(async () => store.writeSourceLayers('demo', new Map([['sources.a.b.yaml', 'x']]), [])).toThrow(ApiError);
      expect(existsSync(path.join(tmp.testframeDir, 'sources.a.b.yaml'))).toBe(true);

      // The REMOVAL side is as broad as the recognition side: a file that is read and reported can
      // never be part of a model, so a save is the only way to get rid of it.
      const result = await store.writeSourceLayers('demo', new Map([['sources.yaml', 'environments: [local]\n']]), [
        'sources.a.b.yaml',
        'sources.other.yaml'
      ]);
      expect(result.removed).toBe(2);
      expect(existsSync(path.join(tmp.testframeDir, 'sources.a.b.yaml'))).toBe(false);
      expect(existsSync(path.join(tmp.testframeDir, 'sources.other.yaml'))).toBe(false);
      expect(tmp.read('sources.yaml')).toBe('environments: [local]\n');

      // a file the store does not read as a sources layer is never removed by a sources save
      expect(tmp.read('settings.yaml')).toBe('openapi: {}\n');
      expect(async () => store.writeSourceLayers('demo', new Map(), ['settings.yaml'])).toThrow(ApiError);
      expect(async () => store.writeSourceLayers('demo', new Map(), ['../../etc/passwd.yaml'])).toThrow(ApiError);
      expect(tmp.read('settings.yaml')).toBe('openapi: {}\n');
    } finally {
      tmp.cleanup();
    }
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
