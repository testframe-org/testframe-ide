import type { CardKind, CardType, CatalogEntry, CatalogResponse, FormKind } from './client-api/testframe.z';
import { testframeApi } from './client-api/testframe';

// ============================================================================
// Domain definitions served by the framework server (GET /api/v2/catalog,
// POST /api/v2/validate). Every source has a TYPE; a card picks a SUBTYPE of it
// when the type has subtypes, and (type, subtype) decide the card type, the
// fence language and the editor form. The editor keeps no
// local copies: loadCatalog() must resolve before the editor renders.
// ============================================================================

let entries: CatalogEntry[] = [];
const byType = new Map<string, CatalogEntry>();

export let SOURCE_TYPES: string[] = [];
export let HTTP_METHODS: string[] = [];

// Card-type keyed defaults, assembled from the catalog's card kinds
// (App gates the editor until loadCatalog resolved, so every card type is filled)
export const DEFAULT_CARD_SIZE = {} as Record<CardType, { width: number; height: number }>;
export const DEFAULT_TIMEOUT = {} as Record<CardType, number>;

export const loadCatalog = async (): Promise<void> => {
  const data: CatalogResponse = await testframeApi.loadCatalog();
  entries = data.sourceTypes;
  byType.clear();
  for (const e of entries) {
    byType.set(e.name, e);
    for (const k of e.cards) {
      if (!DEFAULT_CARD_SIZE[k.cardType]) {
        DEFAULT_CARD_SIZE[k.cardType] = { width: k.defaultWidth, height: k.defaultHeight };
        DEFAULT_TIMEOUT[k.cardType] = k.defaultTimeout;
      }
    }
  }
  SOURCE_TYPES = entries.map((e) => e.name);
  HTTP_METHODS = data.httpMethods;
};

// Subtypes of a type ([] when the type has none: the card then needs no subtype)
export const subtypesOf = (sourceType: string): string[] => byType.get(sourceType)?.subtypes ?? [];

// Whether cards of the type name a source (false for rawvalue and jsonassert: they hold their own code)
export const hasSources = (sourceType: string): boolean => byType.get(sourceType)?.hasSources ?? false;

// Types whose sources can be registered in the Sources tab
export const sourceTypesWithSources = (): string[] => entries.filter((e) => e.hasSources).map((e) => e.name);

// The card kind of (type, subtype), or undefined while the pair is incomplete/invalid
export const cardKindOf = (sourceType: string, subtype?: string): CardKind | undefined =>
  byType.get(sourceType)?.cards.find((k) => (k.subtype ?? undefined) === (subtype || undefined));

// Whether (type, subtype) is complete: a known type, plus a valid subtype when the type has subtypes
export const isCompleteKind = (sourceType: string, subtype?: string): boolean => !!cardKindOf(sourceType, subtype);

// The card type follows (type, subtype) (drives defaults and how the card runs); an
// incomplete pair falls back to the type's first kind, a missing type to json
export const cardTypeOf = (sourceType: string, subtype?: string): CardType =>
  cardKindOf(sourceType, subtype)?.cardType ?? byType.get(sourceType)?.cards[0]?.cardType ?? 'json';

export const formKindOf = (sourceType: string, subtype?: string): FormKind | undefined =>
  cardKindOf(sourceType, subtype)?.form;

export const languageOfKind = (sourceType: string, subtype?: string): string =>
  cardKindOf(sourceType, subtype)?.language ?? byType.get(sourceType)?.language ?? 'json';

// Code rule of a (type, subtype) (mongo: JSON body per subtype, sql/oracle: one SELECT,
// jsonassert/assert: jsonassert lines). The answer is cached per code so live checks stay instant.
const codeCache = new Map<string, Promise<string | null>>();

export const checkSourceCode = (sourceType: string, subtype: string | undefined, code: string): Promise<string | null> => {
  const key = `${sourceType}\u0000${subtype ?? ''}\u0000${code}`;
  let pending = codeCache.get(key);
  if (!pending) {
    pending = testframeApi.validateCode(sourceType, subtype, code).catch(() => null);
    codeCache.set(key, pending);
    if (codeCache.size > 200) {
      const first = codeCache.keys().next().value;
      if (first !== undefined) codeCache.delete(first);
    }
  }
  return pending;
};
