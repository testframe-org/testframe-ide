import type { CardKindEntry, SourceTypeEntry, ValidateResponse } from '@/lib/api/domain';
import type { CardType, FormKind } from '@/lib/format/catalog';
import type { Arg } from '@/lib/format/mongo-call';
import { ideApi } from './api/ide';

// The domain definitions the editor renders come from the IDE (GET /api/v2/catalog,
// POST /api/v2/validate): source types with their subtypes, card kinds (card type, fence
// language, form, defaults), the mongo argument signatures and the HTTP methods. The editor
// keeps no copy of that table — loadCatalog() must resolve before the canvas renders.

let entries: SourceTypeEntry[] = [];
let methods: string[] = [];
const byType = new Map<string, SourceTypeEntry>();
const sizes = new Map<CardType, { width: number; height: number }>();
const timeouts = new Map<CardType, number>();

/** Loads (or reloads) the catalog; resolves once the editor may render. */
export async function loadCatalog(): Promise<void> {
  const data = await ideApi.catalog();
  entries = data.sourceTypes;
  methods = data.httpMethods;
  byType.clear();
  sizes.clear();
  timeouts.clear();
  for (const entry of entries) {
    byType.set(entry.name, entry);
    for (const kind of entry.cards) {
      if (!sizes.has(kind.cardType)) sizes.set(kind.cardType, { width: kind.defaultWidth, height: kind.defaultHeight });
      if (!timeouts.has(kind.cardType)) timeouts.set(kind.cardType, kind.defaultTimeout);
    }
  }
}

export const isLoaded = (): boolean => entries.length > 0;

/** Every source type, in catalog order. */
export const sourceTypes = (): string[] => entries.map((e) => e.name);

/** Types whose cards name a source: the ones the Sources tab registers. */
export const namedSourceTypes = (): string[] => entries.filter((e) => e.hasSources).map((e) => e.name);

export const httpMethods = (): string[] => methods;

/** Subtypes of a type ([] when it has none: its cards then need no subtype). */
export const subtypesOf = (sourceType: string): string[] => byType.get(sourceType)?.subtypes ?? [];

/** Whether cards of this type name a source (false for rawvalue and jsonassert). */
export const hasSources = (sourceType: string): boolean => byType.get(sourceType)?.hasSources ?? false;

/** The card kind of (type, subtype), or undefined while the pair is incomplete or invalid. */
export const cardKindOf = (sourceType: string, subtype?: string): CardKindEntry | undefined =>
  byType.get(sourceType)?.cards.find((k) => (k.subtype ?? undefined) === (subtype || undefined));

/** Whether (type, subtype) names a real card kind. */
export const isCompleteKind = (sourceType: string, subtype?: string): boolean => !!cardKindOf(sourceType, subtype);

/** The card type follows (type, subtype); an incomplete pair falls back to the type's first kind. */
export const cardTypeOf = (sourceType: string, subtype?: string): CardType =>
  cardKindOf(sourceType, subtype)?.cardType ?? byType.get(sourceType)?.cards[0]?.cardType ?? 'json';

export const formKindOf = (sourceType: string, subtype?: string): FormKind | undefined =>
  cardKindOf(sourceType, subtype)?.form;

export const languageOfKind = (sourceType: string, subtype?: string): string =>
  cardKindOf(sourceType, subtype)?.language ?? byType.get(sourceType)?.language ?? 'json';

export const defaultSize = (cardType: CardType): { width: number; height: number } => sizes.get(cardType) ?? { width: 320, height: 210 };

export const defaultTimeout = (cardType: CardType): number => timeouts.get(cardType) ?? 5000;

/** The positional arguments of a mongo subtype (the card body is their JSON array). */
export const mongoArgsOf = (sourceType: string, subtype?: string): Arg[] => cardKindOf(sourceType, subtype)?.args ?? [];

// The code rule of a (type, subtype), answered by the IDE (POST /api/v2/validate). Answers are
// cached per code so the live check while typing stays instant.
const codeCache = new Map<string, Promise<ValidateResponse>>();
const OK: ValidateResponse = { problem: null, problems: [], formatted: null };

export function validateCode(sourceType: string, subtype: string | undefined, code: string): Promise<ValidateResponse> {
  const key = `${sourceType}\u0000${subtype ?? ''}\u0000${code}`;
  let pending = codeCache.get(key);
  if (!pending) {
    pending = ideApi.validate(sourceType, subtype, code).catch(() => OK);
    codeCache.set(key, pending);
    if (codeCache.size > 200) {
      const first = codeCache.keys().next().value;
      if (first !== undefined) codeCache.delete(first);
    }
  }
  return pending;
}
