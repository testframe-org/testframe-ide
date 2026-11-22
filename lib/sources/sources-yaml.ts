import YAML from 'yaml';
import { NAMED_SOURCE_TYPES } from '../format/catalog';
import { environmentNameProblem, sourceNameProblem } from '../format/names';

// The project's sources: testframe/sources.yaml (environments + every source declaration) and
// the layers sources.private.yaml, sources.{env}.yaml, sources.{env}.private.yaml
// (docs/project-format.md, "Sources: sources.yaml and its layers"). This module parses,
// validates, writes (canonical form) and resolves them; the store does the file I/O.

/** header name -> value; null removes the header inherited from an earlier layer. */
export type HeaderMap = Record<string, string | null>;

/** The fields of one source in one layer; null removes the field inherited from an earlier layer. */
export interface SourceFields {
  'base-url'?: string | null;
  headers?: HeaderMap | null;
}

/** One layer: type -> source name -> fields (a source with no fields is `{}`). */
export type LayerData = Record<string, Record<string, SourceFields>>;

export interface EnvLayers {
  public: LayerData;
  private: LayerData;
}

export interface Layers {
  /** sources.yaml without its `environments` list (that one is SourcesModel.environments). */
  base: LayerData;
  private: LayerData;
  env: Record<string, EnvLayers>;
}

export interface SourcesModel {
  environments: string[];
  layers: Layers;
}

export const BASE_FILE = 'sources.yaml';
export const PRIVATE_FILE = 'sources.private.yaml';
export const envFile = (env: string, isPrivate: boolean): string => `sources.${env}${isPrivate ? '.private' : ''}.yaml`;

const FIELDS_BY_TYPE: Record<string, string[]> = {
  openapi: ['base-url', 'headers'],
  mongo: ['base-url'],
  sql: ['base-url'],
  kafka: ['base-url'],
  grpc: ['base-url']
};
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const LAYER_NAME = /^sources\.([a-z0-9]+(?:-[a-z0-9]+)*)(\.private)?\.yaml$/;

/** Where a layer file sits in the stack. */
export type LayerKind = { kind: 'base' } | { kind: 'private' } | { kind: 'env'; env: string; isPrivate: boolean };

/** The place of a sources*.yaml file name in the stack, or null when the name is not a layer. */
export function classify(fileName: string): LayerKind | null {
  if (fileName === BASE_FILE) return { kind: 'base' };
  if (fileName === PRIVATE_FILE) return { kind: 'private' };
  const m = LAYER_NAME.exec(fileName);
  if (!m || m[1] === 'private') return null;
  return { kind: 'env', env: m[1]!, isPrivate: !!m[2] };
}

const emptyModel = (): SourcesModel => ({ environments: [], layers: { base: {}, private: {}, env: {} } });

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------------ YAML parsing

/**
 * Parses one layer file. YAML is restricted to maps, the `environments` list and string scalars:
 * anchors, aliases, tags and multi-documents are errors (a value of another scalar type is
 * reported by the structure validation).
 */
export function parseYaml(fileName: string, text: string): { data: unknown; errors: string[] } {
  const errors: string[] = [];
  const docs = YAML.parseAllDocuments(text);
  if (!Array.isArray(docs)) return { data: {}, errors: [] }; // empty stream
  if (docs.length > 1) errors.push(`${fileName}: one YAML document only (no "---" separators)`);
  const doc = docs[0];
  if (!doc) return { data: {}, errors };
  for (const e of doc.errors) errors.push(`${fileName}: ${e.message.split('\n')[0]}`);
  if (doc.errors.length) return { data: {}, errors };
  YAML.visit(doc, {
    Alias() {
      errors.push(`${fileName}: aliases (*name) are not allowed`);
    },
    Node(_key, node) {
      if (node.anchor) errors.push(`${fileName}: anchors (&${node.anchor}) are not allowed`);
      if (node.tag) errors.push(`${fileName}: tags (${node.tag}) are not allowed`);
    }
  });
  if (errors.length) return { data: {}, errors };
  const data = doc.toJS({ maxAliasCount: 0 }) as unknown;
  return { data: data ?? {}, errors };
}

// ------------------------------------------------------------------ validation

/** Structure of one layer; returns the layer data it could read. */
function validateLayer(file: string, data: unknown, isBase: boolean, errors: string[]): LayerData {
  const out: LayerData = {};
  if (data === null || data === undefined) return out;
  if (!isMap(data)) {
    errors.push(`${file}: the file must be a map (types at the top level)`);
    return out;
  }
  for (const [key, typeValue] of Object.entries(data)) {
    if (key === 'environments') {
      if (!isBase) errors.push(`${file}: environments: only sources.yaml declares the environments`);
      continue;
    }
    if (!NAMED_SOURCE_TYPES.includes(key)) {
      errors.push(`${file}: unknown top-level key "${key}" (${['environments', ...NAMED_SOURCE_TYPES].join(', ')})`);
      continue;
    }
    if (typeValue === null) {
      out[key] = {};
      continue;
    }
    if (!isMap(typeValue)) {
      errors.push(`${file}: ${key}: must be a map of source names`);
      continue;
    }
    const sources: Record<string, SourceFields> = {};
    for (const [name, fields] of Object.entries(typeValue)) {
      const where = `${file}: ${key}.${name}`;
      const nameProblem = sourceNameProblem(name);
      if (nameProblem) {
        errors.push(`${where}: ${nameProblem}`);
        continue;
      }
      if (fields === null) {
        sources[name] = {};
        continue;
      }
      if (!isMap(fields)) {
        errors.push(`${where}: must be a map of fields (${FIELDS_BY_TYPE[key]!.join(', ')}) or {}`);
        continue;
      }
      sources[name] = validateFields(where, key, fields, errors);
    }
    out[key] = sources;
  }
  return out;
}

function validateFields(where: string, type: string, fields: Record<string, unknown>, errors: string[]): SourceFields {
  const out: SourceFields = {};
  for (const [field, value] of Object.entries(fields)) {
    if (!FIELDS_BY_TYPE[type]!.includes(field)) {
      errors.push(`${where}: unknown field "${field}" (${type} sources have ${FIELDS_BY_TYPE[type]!.join(', ')})`);
      continue;
    }
    if (field === 'base-url') {
      if (value !== null && typeof value !== 'string') {
        errors.push(`${where}.base-url: must be a string (quote it)`);
        continue;
      }
      out['base-url'] = value as string | null;
      continue;
    }
    // headers
    if (value === null) {
      out.headers = null;
      continue;
    }
    if (!isMap(value)) {
      errors.push(`${where}.headers: must be a map of header name -> value`);
      continue;
    }
    const headers: HeaderMap = {};
    const seen = new Set<string>();
    for (const [header, headerValue] of Object.entries(value)) {
      if (!HEADER_NAME.test(header)) {
        errors.push(`${where}.headers: invalid header name "${header}" ([A-Za-z0-9-]+)`);
        continue;
      }
      if (seen.has(header.toLowerCase())) {
        errors.push(`${where}.headers: header "${header}" is repeated (names ignore case)`);
        continue;
      }
      seen.add(header.toLowerCase());
      if (headerValue !== null && typeof headerValue !== 'string') {
        errors.push(`${where}.headers.${header}: must be a string (quote it)`);
        continue;
      }
      headers[header] = headerValue as string | null;
    }
    out.headers = headers;
  }
  return out;
}

function validateEnvironments(value: unknown, errors: string[]): string[] {
  if (value === undefined || value === null) {
    errors.push(`${BASE_FILE}: environments: required (e.g. environments: [local])`);
    return [];
  }
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${BASE_FILE}: environments: must be a non-empty list of environment names`);
    return Array.isArray(value) ? [] : [];
  }
  const out: string[] = [];
  for (const env of value) {
    const p = environmentNameProblem(env);
    if (p) {
      errors.push(`${BASE_FILE}: environments: ${p}`);
      continue;
    }
    if (out.includes(env as string)) {
      errors.push(`${BASE_FILE}: environments: "${env}" is listed twice`);
      continue;
    }
    out.push(env as string);
  }
  return out;
}

/** A layer naming a type or source that sources.yaml does not declare. */
function checkDeclared(file: string, layer: LayerData, base: LayerData, errors: string[]): void {
  for (const [type, sources] of Object.entries(layer)) {
    for (const name of Object.keys(sources)) {
      if (!base[type] || !(name in base[type]!)) errors.push(`${file}: ${type}.${name}: not declared in ${BASE_FILE}`);
    }
  }
}

/**
 * Reads the layer files (file name -> YAML text) into the model. Every problem is reported in
 * `errors`; the model holds what could be read. A project without any sources file has no
 * environments and no sources (and no error).
 */
export function readModel(files: Map<string, string>): { model: SourcesModel; errors: string[] } {
  const model = emptyModel();
  const errors: string[] = [];
  if (files.size === 0) return { model, errors };
  const parsed = new Map<string, { kind: LayerKind; data: unknown }>();
  for (const [name, text] of files) {
    const kind = classify(name);
    if (!kind) {
      errors.push(`${name}: not a sources layer (sources.yaml, sources.private.yaml, sources.{env}.yaml, sources.{env}.private.yaml)`);
      continue;
    }
    const { data, errors: yamlErrors } = parseYaml(name, text);
    errors.push(...yamlErrors);
    parsed.set(name, { kind, data });
  }
  const base = parsed.get(BASE_FILE);
  if (!base) {
    errors.push(`${BASE_FILE}: missing (it declares the environments and every source)`);
  } else {
    model.environments = validateEnvironments(isMap(base.data) ? base.data.environments : undefined, errors);
    model.layers.base = validateLayer(BASE_FILE, base.data, true, errors);
  }
  for (const [name, { kind, data }] of parsed) {
    if (kind.kind === 'base') continue;
    const layer = validateLayer(name, data, false, errors);
    checkDeclared(name, layer, model.layers.base, errors);
    if (kind.kind === 'private') {
      model.layers.private = layer;
      continue;
    }
    if (!model.environments.includes(kind.env)) {
      errors.push(`${name}: environment "${kind.env}" is not in the environments list of ${BASE_FILE}`);
    }
    const envLayers = (model.layers.env[kind.env] ??= { public: {}, private: {} });
    envLayers[kind.isPrivate ? 'private' : 'public'] = layer;
  }
  for (const env of model.environments) model.layers.env[env] ??= { public: {}, private: {} };
  return { model, errors };
}

/** Validates a model sent by the editor (same rules as the files); returns every problem. */
export function validateModel(input: unknown): { model: SourcesModel; errors: string[] } {
  const errors: string[] = [];
  const model = emptyModel();
  if (!isMap(input)) return { model, errors: ['sources: expected {environments, layers}'] };
  model.environments = validateEnvironments(input.environments, errors);
  const layers = isMap(input.layers) ? input.layers : {};
  if (isMap(layers.base) && 'environments' in layers.base) {
    errors.push(`${BASE_FILE}: environments: send it as the top-level "environments" field`);
  }
  model.layers.base = validateLayer(BASE_FILE, layers.base ?? {}, true, errors);
  model.layers.private = validateLayer(PRIVATE_FILE, layers.private ?? {}, false, errors);
  checkDeclared(PRIVATE_FILE, model.layers.private, model.layers.base, errors);
  const envs = isMap(layers.env) ? layers.env : {};
  for (const [env, value] of Object.entries(envs)) {
    if (!model.environments.includes(env)) {
      errors.push(`${envFile(env, false)}: environment "${env}" is not in the environments list`);
      continue;
    }
    const v = isMap(value) ? value : {};
    const pub = validateLayer(envFile(env, false), v.public ?? {}, false, errors);
    const priv = validateLayer(envFile(env, true), v.private ?? {}, false, errors);
    checkDeclared(envFile(env, false), pub, model.layers.base, errors);
    checkDeclared(envFile(env, true), priv, model.layers.base, errors);
    model.layers.env[env] = { public: pub, private: priv };
  }
  for (const env of model.environments) model.layers.env[env] ??= { public: {}, private: {} };
  return { model, errors };
}

// ------------------------------------------------------------------ canonical writing

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A layer in canonical order: types in catalog order, sources by name, base-url then headers. */
function canonicalLayer(layer: LayerData): Record<string, Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const type of NAMED_SOURCE_TYPES) {
    const sources = layer[type];
    if (!sources || !Object.keys(sources).length) continue;
    const typeOut: Record<string, Record<string, unknown>> = {};
    for (const name of Object.keys(sources).sort(byName)) {
      const fields = sources[name]!;
      const fieldsOut: Record<string, unknown> = {};
      if ('base-url' in fields) fieldsOut['base-url'] = fields['base-url'] ?? null;
      if ('headers' in fields) {
        const headers = fields.headers;
        if (headers === null || headers === undefined) fieldsOut.headers = null;
        else {
          const sorted: Record<string, string | null> = {};
          for (const h of Object.keys(headers).sort((a, b) => byName(a.toLowerCase(), b.toLowerCase()))) sorted[h] = headers[h] ?? null;
          fieldsOut.headers = sorted;
        }
      }
      typeOut[name] = fieldsOut;
    }
    out[type] = typeOut;
  }
  return out;
}

function renderYaml(environments: string[] | null, layer: LayerData): string | null {
  const content = canonicalLayer(layer);
  if (environments === null && !Object.keys(content).length) return null;
  const doc = new YAML.Document({});
  if (environments !== null) {
    const list = doc.createNode(environments);
    list.flow = true;
    doc.set('environments', list);
  }
  for (const [type, sources] of Object.entries(content)) doc.set(type, doc.createNode(sources));
  return doc.toString({ indent: 2, lineWidth: 0, flowCollectionPadding: false });
}

/**
 * The files of a model in canonical form (two-space indentation; environments first as a flow
 * list; types in catalog order; sources by name; base-url then headers; headers by name; values
 * quoted only when YAML needs it). Empty layers are left out (sources.yaml is always written).
 */
export function renderModel(model: SourcesModel): Map<string, string> {
  const files = new Map<string, string>();
  files.set(BASE_FILE, renderYaml(model.environments, model.layers.base)!);
  const priv = renderYaml(null, model.layers.private);
  if (priv) files.set(PRIVATE_FILE, priv);
  for (const env of model.environments) {
    const layers = model.layers.env[env];
    if (!layers) continue;
    const pub = renderYaml(null, layers.public);
    if (pub) files.set(envFile(env, false), pub);
    const envPriv = renderYaml(null, layers.private);
    if (envPriv) files.set(envFile(env, true), envPriv);
  }
  return files;
}

/** Every declared source as `{type}/{name}`. */
export function declaredRefs(model: SourcesModel): string[] {
  return NAMED_SOURCE_TYPES.flatMap((type) => Object.keys(model.layers.base[type] ?? {}).sort(byName).map((name) => `${type}/${name}`));
}

// ------------------------------------------------------------------ resolution

/** One source resolved for an environment (docs/project-format.md, "Resolution"). */
export interface ResolvedSource {
  ref: string;
  type: string;
  name: string;
  /** The resolved base-url ("" when the source is not configured for the environment). */
  baseUrl: string;
  /** Resolved headers, names lower-case (openapi). */
  headers: Record<string, string>;
  /** Fields whose winning layer is a .private.yaml file (`base-url`, `headers.{name}`). */
  privateFields: string[];
  /** Secret strings of this source (runner-protocol.md, "Secrets"). */
  secrets: string[];
  configured: boolean;
}

interface Winner {
  value: string;
  isPrivate: boolean;
}

/**
 * Resolves every declared source for environment `env`: the layers merged (sources.yaml <-
 * sources.private.yaml <- sources.{env}.yaml <- sources.{env}.private.yaml, last wins; null
 * removes), then `{env}` substituted in base-url and header values.
 */
export function resolve(model: SourcesModel, env: string): Map<string, ResolvedSource> {
  const envLayers = model.layers.env[env] ?? { public: {}, private: {} };
  const stack: { layer: LayerData; isPrivate: boolean }[] = [
    { layer: model.layers.base, isPrivate: false },
    { layer: model.layers.private, isPrivate: true },
    { layer: envLayers.public, isPrivate: false },
    { layer: envLayers.private, isPrivate: true }
  ];
  const out = new Map<string, ResolvedSource>();
  for (const ref of declaredRefs(model)) {
    const [type, name] = ref.split('/') as [string, string];
    let baseUrl: Winner | null = null;
    let headers = new Map<string, Winner>();
    for (const { layer, isPrivate } of stack) {
      const fields = layer[type]?.[name];
      if (!fields) continue;
      if ('base-url' in fields) baseUrl = fields['base-url'] == null ? null : { value: fields['base-url'], isPrivate };
      if ('headers' in fields) {
        if (fields.headers == null) headers = new Map();
        else {
          for (const [h, v] of Object.entries(fields.headers)) {
            if (v == null) headers.delete(h.toLowerCase());
            else headers.set(h.toLowerCase(), { value: v, isPrivate });
          }
        }
      }
    }
    const sub = (v: string) => v.replaceAll('{env}', env);
    const privateFields: string[] = [];
    const secrets: string[] = [];
    const resolvedUrl = baseUrl ? sub(baseUrl.value) : '';
    if (baseUrl?.isPrivate) {
      privateFields.push('base-url');
      secrets.push(...uriSecrets(resolvedUrl));
    }
    const resolvedHeaders: Record<string, string> = {};
    for (const h of [...headers.keys()].sort(byName)) {
      const w = headers.get(h)!;
      resolvedHeaders[h] = sub(w.value);
      if (w.isPrivate) {
        privateFields.push(`headers.${h}`);
        secrets.push(...headerSecrets(resolvedHeaders[h]!));
      }
    }
    out.set(ref, {
      ref,
      type,
      name,
      baseUrl: resolvedUrl,
      headers: resolvedHeaders,
      privateFields,
      secrets: [...new Set(secrets.filter(Boolean))],
      configured: resolvedUrl.trim() !== ''
    });
  }
  return out;
}

const USER_INFO = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/@?#]*)@/;

/** A private URI: the whole value, its user-info `user:password` and the password. */
function uriSecrets(value: string): string[] {
  const out = [value];
  const m = USER_INFO.exec(value);
  if (m) {
    const userInfo = m[1]!;
    const colon = userInfo.indexOf(':');
    if (colon >= 0) out.push(userInfo, userInfo.slice(colon + 1));
  }
  return out;
}

/** A private header value: the whole value and, for `{scheme} {token}` values, the token. */
function headerSecrets(value: string): string[] {
  const m = /^(\S+)\s+(\S.*)$/.exec(value);
  return m ? [value, m[2]!] : [value];
}
