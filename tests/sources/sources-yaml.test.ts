import { describe, expect, test } from 'bun:test';
import {
  PRIVATE_MARKER,
  maskModel,
  readModel,
  redact,
  renderModel,
  resolve,
  secretsOf,
  unmaskModel,
  validateModel,
  type SourcesModel
} from '@/lib/sources/sources-yaml';

// The layered sources (agents/specs/project-format.md, "Sources"): merge order, null removal, header
// names across layers, {env} substitution, the secrets of private values (same derivation as the
// plugin's SourcesDecoder.secretsOf), the canonical round trip, and the masking that keeps every
// private value out of the browser.

const files = (layers: Record<string, string>): Map<string, string> => new Map(Object.entries(layers));

function model(layers: Record<string, string>): SourcesModel {
  const { model: m, errors } = readModel(files(layers));
  expect(errors).toEqual([]);
  return m;
}

describe('sources: resolution', () => {
  test('the 4 layers merge in order: sources <- private <- {env} <- {env}.private (last wins)', () => {
    const m = model({
      'sources.yaml': 'environments: [hml, prod]\nopenapi:\n  api:\n    base-url: http://base\n    headers:\n      A: base\n      B: base\n      C: base\n      D: base\n',
      'sources.private.yaml': 'openapi:\n  api:\n    headers:\n      B: private\n      C: private\n      D: private\n',
      'sources.hml.yaml': 'openapi:\n  api:\n    headers:\n      C: hml\n      D: hml\n',
      'sources.hml.private.yaml': 'openapi:\n  api:\n    headers:\n      D: hml-private\n'
    });
    const hml = resolve(m, 'hml').get('openapi/api')!;
    expect(hml.headers).toEqual({ a: 'base', b: 'private', c: 'hml', d: 'hml-private' });
    expect(hml.privateFields).toEqual(['headers.b', 'headers.d']);
    // another environment only sees the common layers
    expect(resolve(m, 'prod').get('openapi/api')!.headers).toEqual({ a: 'base', b: 'private', c: 'private', d: 'private' });
  });

  test('null removes an inherited base-url and an inherited header', () => {
    const m = model({
      'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://base\n    headers:\n      X-Keep: k\n      X-Drop: d\n',
      'sources.hml.yaml': 'openapi:\n  api:\n    base-url: null\n    headers:\n      X-Drop: null\n'
    });
    const api = resolve(m, 'hml').get('openapi/api')!;
    expect(api.baseUrl).toBe('');
    expect(api.configured).toBe(false);
    expect(api.headers).toEqual({ 'x-keep': 'k' });
  });

  test('headers: null drops the whole inherited map', () => {
    const m = model({
      'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://base\n    headers:\n      A: a\n',
      'sources.hml.yaml': 'openapi:\n  api:\n    headers: null\n'
    });
    expect(resolve(m, 'hml').get('openapi/api')!.headers).toEqual({});
  });

  test('header names compare case-insensitively across layers (X-Tenant vs x-tenant) and come out lower-case', () => {
    const m = model({
      'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://base\n    headers:\n      X-Tenant: base\n',
      'sources.hml.yaml': 'openapi:\n  api:\n    headers:\n      x-tenant: hml\n'
    });
    expect(resolve(m, 'hml').get('openapi/api')!.headers).toEqual({ 'x-tenant': 'hml' });
  });

  test('a header repeated in one map ignoring case is a validation error', () => {
    const { errors } = readModel(files({
      'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    headers:\n      X-Tenant: a\n      x-tenant: b\n'
    }));
    expect(errors.some((e) => e.includes('"x-tenant" is repeated'))).toBe(true);
  });

  test('only the exact token {env} is substituted ({envx} is left as written)', () => {
    const m = model({
      'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://api-{env}.dev/{envx}/{env}\n    headers:\n      X-Env: "{env}-{ENV}"\n'
    });
    const api = resolve(m, 'hml').get('openapi/api')!;
    expect(api.baseUrl).toBe('http://api-hml.dev/{envx}/hml');
    expect(api.headers['x-env']).toBe('hml-{ENV}');
  });

  test('a private winner produces secrets: the URI, user:password and the password; a Bearer header and its token', () => {
    const m = model({
      'sources.yaml': 'environments: [hml]\nmongo:\n  db:\n    base-url: mongodb://localhost/x\nopenapi:\n  api:\n    base-url: http://api\n',
      'sources.hml.private.yaml': 'mongo:\n  db:\n    base-url: mongodb://app:s3cret@db-{env}:27017/x\nopenapi:\n  api:\n    headers:\n      Authorization: Bearer tok-123\n'
    });
    const resolved = resolve(m, 'hml');
    const db = resolved.get('mongo/db')!;
    expect(db.baseUrl).toBe('mongodb://app:s3cret@db-hml:27017/x');
    expect(db.secrets).toEqual(['mongodb://app:s3cret@db-hml:27017/x', 'app:s3cret', 's3cret']);
    const api = resolved.get('openapi/api')!;
    expect(api.secrets).toEqual(['Bearer tok-123', 'tok-123']);
    expect(api.privateFields).toEqual(['headers.authorization']);
  });

  test('a public env layer overriding a private base value makes it public again (no secret)', () => {
    const m = model({
      'sources.yaml': 'environments: [hml]\nmongo:\n  db:\n    base-url: mongodb://localhost/x\n',
      'sources.private.yaml': 'mongo:\n  db:\n    base-url: mongodb://app:s3cret@db/x\n',
      'sources.hml.yaml': 'mongo:\n  db:\n    base-url: mongodb://db-hml/x\n'
    });
    const db = resolve(m, 'hml').get('mongo/db')!;
    expect(db.baseUrl).toBe('mongodb://db-hml/x');
    expect(db.privateFields).toEqual([]);
    expect(db.secrets).toEqual([]);
  });
});

describe('sources: secret derivation (parity with the plugin SourcesDecoder.secretsOf)', () => {
  test('a URL-encoded password also yields its decoded forms', () => {
    expect(secretsOf('mongodb://app:p%40ss%2Fw@db/x', false)).toEqual([
      'mongodb://app:p%40ss%2Fw@db/x',
      'app:p%40ss%2Fw',
      'p%40ss%2Fw',
      'p@ss/w',
      'app:p@ss/w'
    ]);
  });

  test('a plus in the password stays a plus (no form decoding)', () => {
    expect(secretsOf('mongodb://app:a+b@db/x', false)).toEqual(['mongodb://app:a+b@db/x', 'app:a+b', 'a+b']);
  });

  test('user-info without a password is not a password secret', () => {
    expect(secretsOf('mongodb://app@db/x', false)).toEqual(['mongodb://app@db/x']);
  });

  test('a header token is trimmed and a URI inside a header value is also decomposed', () => {
    expect(secretsOf('Basic   abc==  ', true)).toEqual(['Basic   abc==  ', 'abc==']);
    expect(secretsOf('http://u:pw@h/', true)).toEqual(['http://u:pw@h/', 'u:pw', 'pw']);
  });

  test('a non-header value does not split a scheme token', () => {
    expect(secretsOf('Bearer tok', false)).toEqual(['Bearer tok']);
  });

  test('empty values give no secrets', () => {
    expect(secretsOf('', true)).toEqual([]);
  });
});

describe('sources: canonical render', () => {
  test('render -> read -> render is a fixed point and keeps nulls', () => {
    const m = model({
      'sources.yaml': 'environments: [hml, prod]\nmongo:\n  db: {}\nopenapi:\n  api:\n    base-url: "http://api-{env}"\n    headers:\n      b-h: "2"\n      A-H: "1"\n',
      'sources.private.yaml': 'openapi:\n  api:\n    headers:\n      Authorization: Bearer x\n',
      'sources.hml.yaml': 'openapi:\n  api:\n    base-url: null\n'
    });
    const once = renderModel(m);
    const twice = renderModel(model(Object.fromEntries(once)));
    expect(Object.fromEntries(twice)).toEqual(Object.fromEntries(once));
    expect(once.get('sources.yaml')).toBe(
      'environments: [hml, prod]\nopenapi:\n  api:\n    base-url: http://api-{env}\n    headers:\n      A-H: "1"\n      b-h: "2"\nmongo:\n  db: {}\n'
    );
    expect(once.get('sources.hml.yaml')).toBe('openapi:\n  api:\n    base-url: null\n');
    expect([...once.keys()].sort()).toEqual(['sources.hml.yaml', 'sources.private.yaml', 'sources.yaml']);
  });
});

describe('sources: masking (no private value reaches the browser)', () => {
  const disk = () => model({
    'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://api\n    headers:\n      X-Public: pub\n',
    'sources.private.yaml': 'openapi:\n  api:\n    headers:\n      Authorization: Bearer base-token\n',
    'sources.hml.private.yaml': 'openapi:\n  api:\n    base-url: http://u:hml-pass@api-hml\n    headers:\n      X-Drop: null\n'
  });

  test('every private string becomes the marker; nulls and public layers stay', () => {
    const masked = maskModel(disk());
    expect(masked.layers.private).toEqual({ openapi: { api: { headers: { Authorization: PRIVATE_MARKER } } } });
    expect(masked.layers.env.hml!.private).toEqual({ openapi: { api: { 'base-url': PRIVATE_MARKER, headers: { 'X-Drop': null } } } });
    expect(masked.layers.base.openapi!.api!.headers).toEqual({ 'X-Public': 'pub' });
    const text = JSON.stringify(masked);
    for (const secret of ['base-token', 'hml-pass', 'Bearer']) expect(text).not.toContain(secret);
  });

  test('round trip: the masked model saved as is keeps every value on disk', () => {
    const stored = disk();
    const { model: sent } = validateModel(maskModel(stored));
    const { model: back, errors } = unmaskModel(sent, stored);
    expect(errors).toEqual([]);
    expect(Object.fromEntries(renderModel(back))).toEqual(Object.fromEntries(renderModel(stored)));
  });

  test('a marker in a shared layer is refused (a secret never moves to a committed file)', () => {
    const stored = disk();
    const sent = maskModel(stored);
    sent.layers.base.openapi!.api!['base-url'] = PRIVATE_MARKER;
    const { errors } = unmaskModel(sent, stored);
    expect(errors).toEqual(['sources.yaml: openapi.api.base-url: a stored private value cannot move to a shared layer (type the value)']);
  });

  test('a marker with nothing stored at that place is refused (no copying across sources or layers)', () => {
    const stored = disk();
    const sent = maskModel(stored);
    // the hml credential layer's marker moved to the common credential layer
    sent.layers.private.openapi!.api!['base-url'] = PRIVATE_MARKER;
    const { errors } = unmaskModel(sent, stored);
    expect(errors).toEqual(['sources.private.yaml: openapi.api.base-url: no stored private value to keep (type the value again)']);
  });

  test('header markers match the stored header ignoring case', () => {
    const stored = disk();
    const sent = maskModel(stored);
    sent.layers.private.openapi!.api!.headers = { authorization: PRIVATE_MARKER };
    const { model: back, errors } = unmaskModel(sent, stored);
    expect(errors).toEqual([]);
    expect(back.layers.private.openapi!.api!.headers).toEqual({ authorization: 'Bearer base-token' });
  });
});

describe('sources: redaction', () => {
  test('secrets are replaced raw, JSON-escaped and URL-encoded, longest first; user-info always', () => {
    const secrets = ['mongodb://app:s3"c/r@db/x', 'app:s3"c/r', 's3"c/r'];
    expect(redact('at mongodb://app:s3"c/r@db/x now', secrets)).toBe('at *** now');
    expect(redact('json "s3\\"c/r"', secrets)).toBe('json "***"');
    expect(redact('enc s3%22c%2Fr', secrets)).toBe('enc ***');
    expect(redact('other http://x:y@host/', [])).toBe('other http://***@host/');
  });

  test('values under 4 characters are not substring-matched', () => {
    expect(redact('abc in abcdef', ['abc'])).toBe('abc in abcdef');
  });
});
