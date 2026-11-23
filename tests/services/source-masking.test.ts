import { afterEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { GET as sourcesRoute } from '@/app/api/v2/sources/[project]/route';
import { saveSources } from '@/lib/services/sources-save';
import { PRIVATE_MARKER, type SourcesModel } from '@/lib/sources/sources-yaml';
import { ApiError } from '@/lib/format/errors';
import { tmpProject, writeLayers, type TmpProject } from '../helpers/tmp-project';

// USER DECISION (journal #115): private source values are masked. GET /api/v2/sources/{project}
// never returns a value of a .private.yaml layer; a save that keeps the marker keeps the value
// on disk, a new value replaces it, a removed key removes it.

const servicesKey = Symbol.for('testframe.services');
const SECRETS = ['hunter2', 'tok-base', 'tok-hml', 'app:hunter2'];

let tmp: TmpProject | null = null;
afterEach(() => {
  tmp?.cleanup();
  tmp = null;
  delete (globalThis as Record<symbol, unknown>)[servicesKey];
});

function setup(): TmpProject {
  tmp = tmpProject('demo', async () => {
    throw new Error('offline');
  });
  writeLayers(tmp, {
    'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://api\n    headers:\n      X-Public: pub\nmongo:\n  db: {}\n',
    'sources.private.yaml': 'openapi:\n  api:\n    headers:\n      Authorization: Bearer tok-base\n',
    'sources.hml.private.yaml': 'openapi:\n  api:\n    headers:\n      X-Token: tok-hml\nmongo:\n  db:\n    base-url: mongodb://app:hunter2@db-hml/x\n'
  });
  (globalThis as Record<symbol, unknown>)[servicesKey] = tmp.services;
  return tmp;
}

async function getSources(): Promise<SourcesModel & { errors: string[] }> {
  const res = await sourcesRoute(new NextRequest('http://localhost:15198/api/v2/sources/demo', { headers: { host: 'localhost:15198' } }), {
    params: Promise.resolve({ project: 'demo' })
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  return JSON.parse(text) as SourcesModel & { errors: string[] };
}

describe('GET /api/v2/sources/{project}: private values are masked', () => {
  test('no private value is in the answer; each one is the marker', async () => {
    setup();
    const got = await getSources();
    expect(got.errors).toEqual([]);
    expect(got.layers.private).toEqual({ openapi: { api: { headers: { Authorization: PRIVATE_MARKER } } } });
    expect(got.layers.env.hml!.private).toEqual({
      openapi: { api: { headers: { 'X-Token': PRIVATE_MARKER } } },
      mongo: { db: { 'base-url': PRIVATE_MARKER } }
    });
    expect(got.layers.base.openapi!.api!.headers).toEqual({ 'X-Public': 'pub' });
  });
});

describe('POST /api/v2/sources with markers', () => {
  const save = (t: TmpProject, model: SourcesModel) => saveSources(t.services, { project: 'demo', env: 'hml', ...model });

  test('saving what GET returned keeps every private value on disk, byte for byte', async () => {
    const t = setup();
    const before = ['sources.yaml', 'sources.private.yaml', 'sources.hml.private.yaml'].map((f) => t.read(f));
    const { errors: _errors, ...model } = await getSources();
    await save(t, model);
    expect(['sources.yaml', 'sources.private.yaml', 'sources.hml.private.yaml'].map((f) => t.read(f))).toEqual(before);
  });

  test('a new value replaces the stored one; a removed key removes it', async () => {
    const t = setup();
    const { errors: _errors, ...model } = await getSources();
    model.layers.private.openapi!.api!.headers = { Authorization: 'Bearer tok-new' };
    model.layers.env.hml!.private = { mongo: { db: { 'base-url': PRIVATE_MARKER } } }; // X-Token removed
    await save(t, model);
    expect(t.read('sources.private.yaml')).toBe('openapi:\n  api:\n    headers:\n      Authorization: Bearer tok-new\n');
    expect(t.read('sources.hml.private.yaml')).toBe('mongo:\n  db:\n    base-url: mongodb://app:hunter2@db-hml/x\n');
    // and the new value is masked as well
    const again = await getSources();
    expect(JSON.stringify(again)).not.toContain('tok-new');
  });

  test('removing every value of a private layer deletes the file', async () => {
    const t = setup();
    const { errors: _errors, ...model } = await getSources();
    model.layers.private = {};
    await save(t, model);
    expect(() => t.read('sources.private.yaml')).toThrow();
  });

  test('a marker moved to a shared layer or another source is a 400 and nothing is written', async () => {
    const t = setup();
    const before = ['sources.yaml', 'sources.private.yaml', 'sources.hml.private.yaml'].map((f) => t.read(f));
    const { errors: _errors, ...model } = await getSources();

    const toShared = structuredClone(model);
    toShared.layers.base.openapi!.api!.headers = { 'X-Public': 'pub', Authorization: PRIVATE_MARKER };
    const shared = await save(t, toShared).catch((e: unknown) => e);
    expect(shared).toBeInstanceOf(ApiError);
    expect((shared as ApiError).status).toBe(400);

    const toOther = structuredClone(model);
    toOther.layers.private.mongo = { db: { 'base-url': PRIVATE_MARKER } };
    const other = await save(t, toOther).catch((e: unknown) => e);
    expect((other as ApiError).status).toBe(400);
    expect((other as ApiError).message).toContain('sources.private.yaml: mongo.db.base-url: no stored private value to keep');

    expect(['sources.yaml', 'sources.private.yaml', 'sources.hml.private.yaml'].map((f) => t.read(f))).toEqual(before);
  });
});
