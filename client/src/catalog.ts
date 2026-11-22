import type { CardType, CatalogEntry, CatalogResponse } from './client-api/testframe.z';
import { testframeApi } from './client-api/testframe';

// ============================================================================
// Domain definitions served by the framework server (GET /api/v2/catalog,
// POST /api/v2/validate — Phase 2 of the service-layer plan). The editor keeps
// no local copies: loadCatalog() must resolve before the editor renders.
// ============================================================================

let entries: CatalogEntry[] = [];
const bySource = new Map<string, CatalogEntry>();

export let SOURCE_TYPES: string[] = [];
export let HTTP_METHODS: string[] = [];

// Card-type keyed defaults, assembled from the catalog entries of each family
// (App gates the editor until loadCatalog resolved, so every card type is filled)
export const DEFAULT_CARD_SIZE = {} as Record<CardType, { width: number; height: number }>;
export const DEFAULT_TIMEOUT = {} as Record<CardType, number>;

export const loadCatalog = async (): Promise<void> => {
  const data: CatalogResponse = await testframeApi.loadCatalog();
  entries = data.sourceTypes;
  bySource.clear();
  for (const e of entries) {
    bySource.set(e.name, e);
    if (!DEFAULT_CARD_SIZE[e.cardType]) {
      DEFAULT_CARD_SIZE[e.cardType] = { width: e.defaultWidth, height: e.defaultHeight };
      DEFAULT_TIMEOUT[e.cardType] = e.defaultTimeout;
    }
  }
  SOURCE_TYPES = entries.map((e) => e.name);
  HTTP_METHODS = data.httpMethods;
};

// The card type follows the source type (drives defaults and how the card runs)
export const cardTypeOf = (sourceType: string): CardType =>
  bySource.get(sourceType)?.cardType ?? 'json';

export const hasScripts = (typeSource: string): boolean =>
  bySource.get(typeSource)?.hasScripts ?? true;

// Code rule of a source type (mongo: one shell call, oracle: one SELECT, assert:
// jsonassert lines). The answer is cached per code so live checks stay instant.
const codeCache = new Map<string, Promise<string | null>>();

export const checkSourceCode = (sourceType: string, code: string): Promise<string | null> => {
  const key = `${sourceType}\u0000${code}`;
  let pending = codeCache.get(key);
  if (!pending) {
    pending = testframeApi.validateCode(sourceType, code).catch(() => null);
    codeCache.set(key, pending);
    if (codeCache.size > 200) {
      const first = codeCache.keys().next().value;
      if (first !== undefined) codeCache.delete(first);
    }
  }
  return pending;
};
