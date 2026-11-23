import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from '@/lib/format/errors';
import { httpFetcher } from '@/lib/openapi/openapi-service';
import { parseSpec, specUrlHash } from '@/lib/openapi/openapi-spec';
import { saveSources } from '@/lib/services/sources-save';
import { tmpProject, writeLayers, type TmpProject } from '../helpers/tmp-project';

// The openapi spec URL is a source's resolved base-url, which a .private.yaml layer can set (with
// user-info or a token): it is never written to the .testframebuild/ cache, never returned by the
// operations endpoints, never left in an error message or a save warning, and a redirect never
// carries the source's private headers to another host.

const SPEC = JSON.stringify({ openapi: '3.0.0', servers: [{ url: '/api' }], paths: { '/items': { get: { operationId: 'list' } } } });
const PRIVATE_URL = 'http://reader:sp3c-pass@specs.internal/v3/api-docs?token=qtok-9';
const SECRETS = ['sp3c-pass', 'reader:sp3c-pass', 'qtok-9', 'specs.internal/v3', 'hdr-tok'];

let tmp: TmpProject | null = null;
afterEach(() => {
  tmp?.cleanup();
  tmp = null;
});

function setup(fetcher: (url: string, headers: Record<string, string>) => Promise<string>): TmpProject {
  tmp = tmpProject('demo', fetcher);
  writeLayers(tmp, {
    'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://public/spec\n',
    'sources.hml.private.yaml': `openapi:\n  api:\n    base-url: ${PRIVATE_URL}\n    headers:\n      Authorization: Bearer hdr-tok\n`
  });
  return tmp;
}

const allBuildText = (t: TmpProject): string => {
  const root = path.join(t.testframeDir, '.testframebuild');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return out.join('\n');
};

describe('openapi operations: no spec URL in cache or answers', () => {
  test('the cache is keyed by the SHA-256 of the URL and holds neither the URL nor its credentials', async () => {
    let fetches = 0;
    const t = setup(async () => {
      fetches++;
      return SPEC;
    });
    const spec = await t.services.openApi.spec('demo', 'api', 'hml');
    const answer = JSON.stringify(spec);
    expect(Object.keys(spec).sort()).toEqual(['baseUrl', 'fetchedAt', 'operations']);
    expect(spec.baseUrl).toBe('http://specs.internal/api');
    for (const secret of ['sp3c-pass', 'reader:', 'qtok-9', 'hdr-tok']) expect(answer).not.toContain(secret);

    const cache = allBuildText(t);
    expect(cache).toContain(specUrlHash(PRIVATE_URL));
    expect(cache).not.toContain('specUrl"');
    for (const secret of ['sp3c-pass', 'reader:', 'qtok-9', 'hdr-tok', 'api-docs']) expect(cache).not.toContain(secret);

    // the cache is found again by the URL's hash (no second fetch); a refresh answer is masked too
    await t.services.openApi.spec('demo', 'api', 'hml');
    expect(fetches).toBe(1);
    const refreshed = await t.services.openApi.refresh('demo', 'api', 'hml');
    expect(JSON.stringify(refreshed)).not.toContain('sp3c-pass');
    expect(fetches).toBe(2);
  });

  test('a relative server never inherits the spec URL user-info', () => {
    expect(parseSpec('http://u:p@h:8/spec.json', 'now', SPEC).baseUrl).toBe('http://h:8/api');
  });

  test('a failing fetch is a 502 without the URL, its credentials or the header token', async () => {
    const t = setup(async (url, headers) => {
      throw new Error(`connect failed for ${url} with ${headers.authorization}`);
    });
    const error = await t.services.openApi.spec('demo', 'api', 'hml').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    const message = (error as ApiError).message;
    expect(message).toContain('openapi/api');
    for (const secret of SECRETS) expect(message).not.toContain(secret);
  });

  test('a document that is not a spec is a 502 without the URL', async () => {
    const t = setup(async () => 'not json');
    const error = (await t.services.openApi.spec('demo', 'api', 'hml').catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(502);
    for (const secret of SECRETS) expect(error.message).not.toContain(secret);
  });

  test('a save warning about an unreadable spec carries no secret', async () => {
    const t = setup(async (url) => {
      throw new Error(`refused ${url}`);
    });
    const { errors: _e, ...model } = await t.services.sources.view('demo');
    const result = await saveSources(t.services, { project: 'demo', env: 'hml', ...model });
    expect(result.warnings.length).toBe(1);
    for (const secret of SECRETS) expect(result.warnings[0]).not.toContain(secret);
  });

  test('a public spec URL is still named in the error', async () => {
    tmp = tmpProject('demo', async () => {
      throw new Error('down');
    });
    writeLayers(tmp, { 'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://public/spec\n' });
    const error = (await tmp.services.openApi.spec('demo', 'api', 'hml').catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe('cannot read the OpenAPI spec of http://public/spec: down');
  });
});

describe('httpFetcher: redirects are refused (private headers never follow them)', () => {
  test('a 302 to another host fails and the other host never sees the request', async () => {
    const seen: string[] = [];
    const other = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        seen.push(req.headers.get('authorization') ?? '');
        return new Response(SPEC);
      }
    });
    const origin = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { location: `http://localhost:${other.port}/spec` } })
    });
    try {
      const error = await httpFetcher(`http://127.0.0.1:${origin.port}/spec`, { Authorization: 'Bearer hdr-tok' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(seen).toEqual([]);
      // a direct answer still works
      expect(await httpFetcher(`http://127.0.0.1:${other.port}/spec`, {})).toBe(SPEC);
    } finally {
      origin.stop(true);
      other.stop(true);
    }
  });
});
