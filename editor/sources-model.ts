import type { HeaderMap, LayerData, SourceFields, SourcesModel } from '@/lib/sources/sources-yaml';
import { isPrivateMarker } from '@/lib/sources/private-marker';

// Pure helpers over the layered sources model the editor edits (GET/POST /api/v2/sources).
// The model, its validation, the canonical write and the authoritative resolution for a run are
// owned by lib/sources/sources-yaml.ts (spec: agents/specs/project-format.md, "Sources"); this file only
// reads and rebuilds the model immutably for the Sources tab, and derives one display-only value.
// Nothing here touches the disk: the IDE rewrites the layers on save.
//
// Values of the .private.yaml layers never reach the browser: the IDE sends PRIVATE_MARKER in
// their place (lib/sources/private-marker). The editor keeps the marker untouched to keep the
// stored value, replaces it to set a new one, and drops the key to remove it.

/** What the Sources tab edits: every environment at once, or one environment's layers. */
export type SourcesScope = { kind: 'all' } | { kind: 'env'; env: string };

export const ALL_SCOPE: SourcesScope = { kind: 'all' };
export const envScope = (env: string): SourcesScope => ({ kind: 'env', env });

/** Layer file names, for the UI only — the authoritative names live in lib/sources/sources-yaml. */
export const BASE_FILE = 'sources.yaml';
export const PRIVATE_FILE = 'sources.private.yaml';
export const envFile = (env: string, isPrivate: boolean): string => `sources.${env}${isPrivate ? '.private' : ''}.yaml`;

/** Where an effective value comes from. */
export type LayerName = 'base' | 'private' | 'env' | 'env-private';

export const layerFile = (from: LayerName, env: string): string =>
  from === 'base' ? BASE_FILE : from === 'private' ? PRIVATE_FILE : envFile(env, from === 'env-private');

export const emptyModel = (): SourcesModel => ({ environments: [], layers: { base: {}, private: {}, env: {} } });

/** The layer file names a scope writes. */
export function scopeFiles(scope: SourcesScope): string[] {
  return scope.kind === 'all' ? [BASE_FILE, PRIVATE_FILE] : [envFile(scope.env, false), envFile(scope.env, true)];
}

const envLayersOf = (model: SourcesModel, env: string) => model.layers.env[env] ?? { public: {}, private: {} };

/** The two layers of a scope: "all" = base + private, an environment = its override + credentials. */
export function scopeLayer(model: SourcesModel, scope: SourcesScope, isPrivate: boolean): LayerData {
  if (scope.kind === 'all') return isPrivate ? model.layers.private : model.layers.base;
  const layers = envLayersOf(model, scope.env);
  return isPrivate ? layers.private : layers.public;
}

function withScopeLayer(model: SourcesModel, scope: SourcesScope, isPrivate: boolean, layer: LayerData): SourcesModel {
  if (scope.kind === 'all') {
    return { ...model, layers: { ...model.layers, [isPrivate ? 'private' : 'base']: layer } };
  }
  const next = { ...envLayersOf(model, scope.env), [isPrivate ? 'private' : 'public']: layer };
  return { ...model, layers: { ...model.layers, env: { ...model.layers.env, [scope.env]: next } } };
}

/** Rebuilds one source's fields inside one layer of a scope. */
function updateFields(
  model: SourcesModel,
  scope: SourcesScope,
  isPrivate: boolean,
  type: string,
  name: string,
  change: (fields: SourceFields) => SourceFields | null
): SourcesModel {
  const layer = scopeLayer(model, scope, isPrivate);
  const sources = { ...(layer[type] ?? {}) };
  const next = change(sources[name] ?? {});
  if (next === null) delete sources[name];
  else sources[name] = next;
  if (!Object.keys(sources).length) {
    const pruned = { ...layer };
    delete pruned[type];
    return withScopeLayer(model, scope, isPrivate, pruned);
  }
  return withScopeLayer(model, scope, isPrivate, { ...layer, [type]: sources });
}

// ------------------------------------------------------------------ declarations

/** The source names a type declares in sources.yaml, sorted. */
export const sourceNames = (model: SourcesModel, type: string): string[] =>
  Object.keys(model.layers.base[type] ?? {}).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Total number of declared sources (the Sources tab badge). */
export const declaredCount = (model: SourcesModel): number =>
  Object.values(model.layers.base).reduce((total, sources) => total + Object.keys(sources).length, 0);

/** Declares a source in sources.yaml (an empty field map: the layers give it values). */
export const addSource = (model: SourcesModel, type: string, name: string): SourcesModel => {
  if (sourceNames(model, type).includes(name)) return model;
  const layer = { ...model.layers.base, [type]: { ...(model.layers.base[type] ?? {}), [name]: {} } };
  return { ...model, layers: { ...model.layers, base: layer } };
};

/** Drops a source from sources.yaml and every layer that mentions it. */
export function removeSource(model: SourcesModel, type: string, name: string): SourcesModel {
  const drop = (layer: LayerData): LayerData => {
    const sources = layer[type];
    if (!sources || !(name in sources)) return layer;
    const rest = { ...sources };
    delete rest[name];
    const next = { ...layer };
    if (Object.keys(rest).length) next[type] = rest;
    else delete next[type];
    return next;
  };
  const env: SourcesModel['layers']['env'] = {};
  for (const [key, layers] of Object.entries(model.layers.env)) env[key] = { public: drop(layers.public), private: drop(layers.private) };
  return { ...model, layers: { base: drop(model.layers.base), private: drop(model.layers.private), env } };
}

/**
 * Renames a source in sources.yaml and every layer that mentions it. Shared with the server
 * (lib/sources/source-rename.ts): a save applies the same renames to the model on disk, so the
 * private values stored under the old name answer the markers the editor sends under the new one.
 */
export { renameSource } from '@/lib/sources/source-rename';

// ------------------------------------------------------------------ fields

/** One field of one source: what the edited scope holds and what the whole stack yields. */
export interface FieldState {
  /** The value in the scope's layers (its private layer wins), or null when the scope is silent. */
  own: string | null;
  ownIsPrivate: boolean;
  /** The value every layer yields, or null when unset. */
  effective: string | null;
  effectiveIsPrivate: boolean;
  /** The layer the effective value comes from (null when unset). */
  from: LayerName | null;
}

/** Whether the scope's own value is a stored private value the browser cannot see (write-only). */
export const isStoredPrivate = (state: FieldState): boolean => state.ownIsPrivate && isPrivateMarker(state.own);

/**
 * The value a field moves with when its private/shared toggle flips: a stored private value
 * cannot be read, so it is never carried into the shared layer (it is dropped instead).
 */
export const toggledValue = (state: FieldState): string => (isStoredPrivate(state) ? '' : (state.own ?? ''));

const stackOf = (model: SourcesModel, env: string | null): { layer: LayerData; from: LayerName }[] => [
  { layer: model.layers.base, from: 'base' },
  { layer: model.layers.private, from: 'private' },
  ...(env ? [{ layer: envLayersOf(model, env).public, from: 'env' as LayerName }, { layer: envLayersOf(model, env).private, from: 'env-private' as LayerName }] : [])
];

function fieldState(
  model: SourcesModel,
  scope: SourcesScope,
  env: string | null,
  type: string,
  name: string,
  read: (fields: SourceFields) => string | null | undefined,
  has: (fields: SourceFields) => boolean
): FieldState {
  const ownPrivate = read(scopeLayer(model, scope, true)[type]?.[name] ?? {});
  const ownPublic = read(scopeLayer(model, scope, false)[type]?.[name] ?? {});
  const ownIsPrivate = ownPrivate !== null && ownPrivate !== undefined;
  let effective: string | null = null;
  let from: LayerName | null = null;
  for (const { layer, from: layerName } of stackOf(model, env)) {
    const fields = layer[type]?.[name];
    if (!fields || !has(fields)) continue;
    const value = read(fields);
    effective = value ?? null;
    from = value === null ? null : layerName;
  }
  return {
    own: (ownIsPrivate ? ownPrivate : ownPublic) ?? null,
    ownIsPrivate,
    effective,
    effectiveIsPrivate: from === 'private' || from === 'env-private',
    from
  };
}

const readBaseUrl = (fields: SourceFields): string | null | undefined =>
  'base-url' in fields ? (fields['base-url'] ?? null) : undefined;
const hasBaseUrl = (fields: SourceFields): boolean => 'base-url' in fields;

/** base-url of a source: what the scope edits and what the whole stack yields. */
export const baseUrlState = (model: SourcesModel, scope: SourcesScope, env: string | null, type: string, name: string): FieldState =>
  fieldState(model, scope, env, type, name, readBaseUrl, hasBaseUrl);

/**
 * Sets (or, with an empty value, drops the override of) base-url in one layer of the scope.
 * The format also allows an explicit `null` to remove an inherited value; that stays a
 * hand-editing feature, the editor only writes and removes the key.
 */
export const setBaseUrl = (
  model: SourcesModel,
  scope: SourcesScope,
  isPrivate: boolean,
  type: string,
  name: string,
  value: string
): SourcesModel =>
  updateFields(model, scope, isPrivate, type, name, (fields) => {
    const next = { ...fields };
    if (value.trim()) next['base-url'] = value;
    else delete next['base-url'];
    return next;
  });

const headerKey = (headers: HeaderMap | null | undefined, header: string): string | undefined => {
  if (!headers) return undefined;
  const lower = header.toLowerCase();
  return Object.keys(headers).find((k) => k.toLowerCase() === lower);
};

const readHeader = (header: string) => (fields: SourceFields): string | null | undefined => {
  if (!('headers' in fields)) return undefined;
  const headers = fields.headers;
  if (!headers) return null; // the whole map is removed here
  const key = headerKey(headers, header);
  return key === undefined ? undefined : (headers[key] ?? null);
};

const hasHeader = (header: string) => (fields: SourceFields): boolean => {
  if (!('headers' in fields)) return false;
  return fields.headers === null || headerKey(fields.headers, header) !== undefined;
};

/** One header of an openapi source. */
export const headerState = (
  model: SourcesModel,
  scope: SourcesScope,
  env: string | null,
  type: string,
  name: string,
  header: string
): FieldState => fieldState(model, scope, env, type, name, readHeader(header), hasHeader(header));

/** Sets (or, with an empty value, drops) one header in a layer of the scope. */
export const setHeader = (
  model: SourcesModel,
  scope: SourcesScope,
  isPrivate: boolean,
  type: string,
  name: string,
  header: string,
  value: string
): SourcesModel =>
  updateFields(model, scope, isPrivate, type, name, (fields) => {
    const next: SourceFields = { ...fields };
    const headers: HeaderMap = { ...(next.headers ?? {}) };
    const existing = headerKey(headers, header);
    if (existing !== undefined) delete headers[existing];
    if (value.trim()) headers[header] = value;
    next.headers = Object.keys(headers).length ? headers : undefined;
    if (next.headers === undefined) delete next.headers;
    return next;
  });

/** Every header name any layer mentions for a source, deduplicated case-insensitively. */
export function headerNames(model: SourcesModel, env: string | null, type: string, name: string): string[] {
  const seen = new Map<string, string>();
  for (const { layer } of stackOf(model, env)) {
    const headers = layer[type]?.[name]?.headers;
    if (!headers) continue;
    for (const header of Object.keys(headers)) {
      const lower = header.toLowerCase();
      if (!seen.has(lower)) seen.set(lower, header);
    }
  }
  return [...seen.values()].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
}

// ------------------------------------------------------------------ environments

export const addEnvironment = (model: SourcesModel, env: string): SourcesModel =>
  model.environments.includes(env)
    ? model
    : { ...model, environments: [...model.environments, env], layers: { ...model.layers, env: { ...model.layers.env, [env]: { public: {}, private: {} } } } };

export const removeEnvironment = (model: SourcesModel, env: string): SourcesModel => {
  const env2 = { ...model.layers.env };
  delete env2[env];
  return { ...model, environments: model.environments.filter((e) => e !== env), layers: { ...model.layers, env: env2 } };
};

// ------------------------------------------------------------------ display-only resolution

/** A base-url for display, and whether it is a secret the UI must not print. */
export interface DisplayUrl {
  /** The declared value with `{env}` substituted, or null when unset (or private). */
  value: string | null;
  isPrivate: boolean;
  from: LayerName | null;
}

/**
 * Display-only view of a source's base-url in one environment. The authoritative resolution
 * (the one runs use) is server-side: lib/sources/sources-yaml.resolve. Values that come from a
 * .private.yaml layer are secrets: they are reported as private and never handed to the canvas.
 */
export function displayBaseUrl(model: SourcesModel, env: string | null, type: string, name: string): DisplayUrl {
  let value: string | null = null;
  let from: LayerName | null = null;
  for (const { layer, from: layerName } of stackOf(model, env)) {
    const fields = layer[type]?.[name];
    if (!fields || !hasBaseUrl(fields)) continue;
    const raw = readBaseUrl(fields);
    value = raw ?? null;
    from = raw === null ? null : layerName;
  }
  const isPrivate = from === 'private' || from === 'env-private';
  return { value: value === null || isPrivate ? null : value.replaceAll('{env}', env ?? ''), isPrivate, from };
}
