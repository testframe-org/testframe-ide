import { afterEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { guardRequest, readJson } from '@/lib/api/http';
import { ApiError } from '@/lib/format/errors';
import { RunnerClient } from '@/lib/services/runner-client';
import type { Services } from '@/lib/services/context';
import { POST as saveSourcesRoute } from '@/app/api/v2/sources/route';
import { POST as refreshRoute } from '@/app/api/v2/sources/openapi/[name]/operations/refresh/route';
import { GET as catalogRoute } from '@/app/api/v2/catalog/route';
import { POST as tourPost, GET as tourGet } from '@/app/api/tour/[...path]/route';
import { tmpProject, writeLayers, type TmpProject } from '../helpers/tmp-project';

// The request guard (CSRF + DNS rebinding) and the JSON body rule, through the real route
// handlers: a cross-site "simple" POST (text/plain, no preflight), a foreign Origin, a foreign
// Sec-Fetch-Site or a non-loopback Host never reaches a handler, so nothing is written and
// nothing is forwarded to the plugin.

const IDE = 'http://localhost:15198';
const servicesKey = Symbol.for('testframe.services');

let tmp: TmpProject | null = null;
afterEach(() => {
  tmp?.cleanup();
  tmp = null;
  delete (globalThis as Record<symbol, unknown>)[servicesKey];
});

/** Installs a scratch project's services as the process-wide ones the routes use. */
function install(runner?: RunnerClient): { tmp: TmpProject; services: Services } {
  tmp = tmpProject();
  writeLayers(tmp, { 'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://api\n' });
  const services = { ...tmp.services, ...(runner ? { runner } : {}) };
  (globalThis as Record<symbol, unknown>)[servicesKey] = services;
  return { tmp, services };
}

const saveBody = JSON.stringify({ project: 'demo', environments: ['hml'], layers: { base: {}, private: {}, env: {} } });

function request(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`${IDE}${path}`, { method: 'POST', ...init, headers: { host: 'localhost:15198', ...(init.headers ?? {}) } } as ConstructorParameters<typeof NextRequest>[1]);
}

const body = async (res: Response) => (await res.json()) as { status: number; message: string };

describe('readJson: only application/json bodies', () => {
  test('text/plain, form and missing content types are 415', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null, 'application/jsonp', 'text/json']) {
      const req = new Request(IDE, { method: 'POST', body: '{}', headers: type ? { 'content-type': type } : {} });
      if (!type) req.headers.delete('content-type');
      const error = await readJson(req).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(415);
    }
  });

  test('application/json (any case, with charset) is read', async () => {
    const req = new Request(IDE, { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'Application/JSON; charset=utf-8' } });
    expect(await readJson(req)).toEqual({ a: 1 });
  });
});

describe('guardRequest', () => {
  const guard = (method: string, headers: Record<string, string>) => {
    try {
      guardRequest(new Request(`${IDE}/api/v2/sources`, { method, headers }));
      return null;
    } catch (e) {
      return (e as ApiError).status;
    }
  };

  test('same-origin, navigation and header-less (script) requests pass', () => {
    expect(guard('POST', { host: 'localhost:15198', origin: IDE, 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(guard('POST', { host: '127.0.0.1:15198', origin: 'http://127.0.0.1:15198' })).toBeNull();
    expect(guard('POST', { host: 'localhost:15198', 'sec-fetch-site': 'none' })).toBeNull();
    expect(guard('POST', { host: 'localhost:15198' })).toBeNull();
    expect(guard('GET', { host: 'localhost:15198', 'sec-fetch-site': 'cross-site' })).toBeNull();
  });

  test('a state-changing request from another site, another port or an opaque origin is 403', () => {
    expect(guard('POST', { host: 'localhost:15198', 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(guard('DELETE', { host: 'localhost:15198', 'sec-fetch-site': 'same-site' })).toBe(403);
    expect(guard('POST', { host: 'localhost:15198', origin: 'http://evil.example' })).toBe(403);
    expect(guard('POST', { host: 'localhost:15198', origin: 'http://localhost:15174' })).toBe(403);
    expect(guard('PUT', { host: 'localhost:15198', origin: 'null' })).toBe(403);
    expect(guard('PATCH', { host: 'localhost:15198', origin: 'file://' })).toBe(403);
  });

  test('a request addressed to a non-loopback host is 403, reads included (DNS rebinding)', () => {
    expect(guard('GET', { host: 'evil.example:15198' })).toBe(403);
    expect(guard('POST', { host: 'evil.example:15198', origin: 'http://evil.example:15198' })).toBe(403);
    expect(guard('GET', { host: '192.168.1.5:15198' })).toBe(403);
    expect(guard('GET', { host: '[::1]:15198' })).toBeNull();
  });
});

describe('routes: CSRF cannot write the project', () => {
  test('a cross-site text/plain POST to /api/v2/sources is refused and writes nothing', async () => {
    const { tmp } = install();
    const before = tmp.read('sources.yaml');
    const plain = await saveSourcesRoute(request('/api/v2/sources', { body: saveBody, headers: { 'content-type': 'text/plain' } }));
    expect(plain.status).toBe(415);
    const crossSite = await saveSourcesRoute(request('/api/v2/sources', {
      body: saveBody,
      headers: { 'content-type': 'application/json', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' }
    }));
    expect(crossSite.status).toBe(403);
    expect(tmp.read('sources.yaml')).toBe(before);
    // the same request from the IDE itself goes through
    const ok = await saveSourcesRoute(request('/api/v2/sources', {
      body: saveBody,
      headers: { 'content-type': 'application/json', origin: IDE, 'sec-fetch-site': 'same-origin' }
    }));
    expect(ok.status).toBe(200);
    expect(tmp.read('sources.yaml')).toBe('environments: [hml]\n');
  });

  test('a bodyless cross-site POST (operations refresh) is refused by the guard', async () => {
    install();
    const res = await refreshRoute(request('/api/v2/sources/openapi/api/operations/refresh?project=demo&env=hml', { headers: { origin: 'http://evil.example' } }), {
      params: Promise.resolve({ name: 'api' })
    });
    expect(res.status).toBe(403);
  });

  test('every route goes through the guard (a GET to a rebinding host is refused)', async () => {
    install();
    const res = await catalogRoute(new NextRequest(`http://evil.example:15198/api/v2/catalog`, { headers: { host: 'evil.example:15198' } }));
    expect(res.status).toBe(403);
    expect((await body(res)).message).toContain('loopback');
  });
});

describe('routes: the tour proxy', () => {
  function fakeRunner() {
    const calls: { url: string; init?: RequestInit }[] = [];
    const runner = new RunnerClient('http://runner.test', 'plugin-token', async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true });
    });
    return { runner, calls };
  }

  const params = (...path: string[]) => ({ params: Promise.resolve({ path }) });

  test('"..", "." and empty segments (raw or encoded) never reach the plugin', async () => {
    const { runner, calls } = fakeRunner();
    install(runner);
    for (const path of [['..', 'run'], ['.', 'projects'], ['', 'x'], ['%2e%2e', 'run'], ['%252e%252e', 'run'], ['..%2frun'], ['a', '..', '..', 'run']]) {
      const res = await tourGet(request('/api/tour/x', { method: 'GET' }), params(...path));
      expect(res.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  test('a cross-site or text/plain POST to the tour is refused before forwarding', async () => {
    const { runner, calls } = fakeRunner();
    install(runner);
    const run = ['projects', 'demo', 'frames', 'main', 'run'];
    const crossSite = await tourPost(request('/api/tour/projects/demo/frames/main/run', {
      body: '{}',
      headers: { 'content-type': 'application/json', 'content-length': '2', 'sec-fetch-site': 'cross-site' }
    }), params(...run));
    expect(crossSite.status).toBe(403);
    const plain = await tourPost(request('/api/tour/projects/demo/frames/main/run', {
      body: '{}',
      headers: { 'content-type': 'text/plain', 'content-length': '2' }
    }), params(...run));
    expect(plain.status).toBe(415);
    expect(calls).toEqual([]);
  });

  test('a valid request is forwarded under /api/v1/tour with the token added server-side', async () => {
    const { runner, calls } = fakeRunner();
    install(runner);
    const res = await tourGet(request('/api/tour/projects/demo/frames?x=1', {
      method: 'GET',
      headers: { authorization: 'Bearer browser-supplied', cookie: 'session=1' }
    }), params('projects', 'demo', 'frames'));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(['http://runner.test/api/v1/tour/projects/demo/frames?x=1']);
    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get('authorization')).toBe('Bearer plugin-token');
    expect(headers.get('cookie')).toBeNull();
    // a bodyless cancel POST is fine
    const cancel = await tourPost(request('/api/tour/runs/r-1/cancel', { headers: { origin: IDE } }), params('runs', 'r-1', 'cancel'));
    expect(cancel.status).toBe(200);
    expect(calls[1]!.url).toBe('http://runner.test/api/v1/tour/runs/r-1/cancel');
  });
});
