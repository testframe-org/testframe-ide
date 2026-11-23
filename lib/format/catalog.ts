// Source types, their card subtypes and the card defaults derived from them
// (agents/specs/project-format.md, "Source types and subtypes"). A source has a TYPE; a card bound to it
// picks a SUBTYPE of that type when the type has subtypes. The card type, fence language, form
// and the defaults all follow (type, subtype) and are never stored.

/** What a card of one (type, subtype) is: `subtype` is null for types without subtypes. */
export interface Kind {
  subtype: string | null;
  cardType: CardType;
  language: string;
  /** The editor form that fills it. */
  form: FormKind;
}

export type CardType = 'request' | 'query' | 'js' | 'sql' | 'jsonassert' | 'condition' | 'json';
export type FormKind = 'request' | 'swagger' | 'mongo' | 'query' | 'script' | 'condition' | 'json' | 'code';

/**
 * A source type: `language` is its default fence language; `hasSources` = cards name a source of
 * the type (`source: {type}/{name}`), otherwise the card writes the type alone (rawvalue,
 * jsonassert); `kinds` has one entry per subtype (or one without subtype).
 */
export interface SourceType {
  name: string;
  language: string;
  hasSources: boolean;
  kinds: Kind[];
}

export const RAWVALUE = 'rawvalue';

const kind = (subtype: string | null, cardType: CardType, language: string, form: FormKind): Kind => ({
  subtype,
  cardType,
  language,
  form
});

const MONGO_SUBTYPES = ['find', 'aggregation', 'deleteOne', 'deleteMany', 'updateOne', 'updateMany', 'insertOne', 'insertMany'];

export const TYPES: readonly SourceType[] = [
  {
    name: 'openapi',
    language: 'js',
    hasSources: true,
    kinds: [
      kind('restapi', 'request', 'js', 'request'),
      // the openapi source's base-url is the OpenAPI spec, which defines every endpoint
      kind('swagger', 'request', 'json', 'swagger'),
      kind('graphql', 'request', 'js', 'request')
    ]
  },
  {
    name: 'mongo',
    language: 'json',
    hasSources: true,
    // the body is the array of the call's positional arguments (mongo-call.ts)
    kinds: MONGO_SUBTYPES.map((s) => kind(s, 'query', 'json', 'mongo'))
  },
  {
    name: 'sql',
    language: 'sql',
    hasSources: true,
    kinds: ['oracle', 'postgres', 'mysql', 'sqlserver'].map((s) => kind(s, 'sql', 'sql', 'query'))
  },
  // jsonassert code always lives in the card itself: no named sources.
  // script: assert lines and/or expressions; conditional: one boolean expression
  {
    name: 'jsonassert',
    language: 'jsonassert',
    hasSources: false,
    kinds: [kind('script', 'jsonassert', 'jsonassert', 'script'), kind('conditional', 'condition', 'jsonassert', 'condition')]
  },
  { name: 'kafka', language: 'js', hasSources: true, kinds: [kind(null, 'js', 'js', 'code')] },
  { name: 'grpc', language: 'js', hasSources: true, kinds: [kind(null, 'js', 'js', 'code')] },
  // a literal value held by the card; json is its only subtype for now
  { name: RAWVALUE, language: 'json', hasSources: false, kinds: [kind('json', 'json', 'json', 'json')] }
];

export const SOURCE_TYPES: readonly string[] = TYPES.map((t) => t.name);

/** Types with named sources, in catalog order (the order of sources.yaml). */
export const NAMED_SOURCE_TYPES: readonly string[] = TYPES.filter((t) => t.hasSources).map((t) => t.name);

export const HTTP_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const hasSubtypes = (type: SourceType): boolean => type.kinds[0]!.subtype !== null;

export const subtypesOf = (type: SourceType): string[] =>
  hasSubtypes(type) ? type.kinds.map((k) => k.subtype!) : [];

const blank = (s: string | null | undefined) => !s || s.trim() === '';

/** The type named `name`; a blank name is the rawvalue type (literal value cards). */
export function typeOf(name: string | null | undefined): SourceType | undefined {
  const key = blank(name) ? RAWVALUE : name;
  return TYPES.find((t) => t.name === key);
}

/** The card kind of (type, subtype), or undefined when the type is unknown or the subtype invalid. */
export function kindOf(typeName: string | null | undefined, subtype: string | null | undefined): Kind | undefined {
  const sub = blank(subtype) ? null : subtype!;
  return typeOf(typeName)?.kinds.find((k) => k.subtype === sub);
}

/** Defaults while (type, subtype) is still invalid (a draft): the type's first kind, else rawvalue's. */
function kindOrFallback(typeName: string | null | undefined, subtype: string | null | undefined): Kind {
  return kindOf(typeName, subtype) ?? typeOf(typeName)?.kinds[0] ?? typeOf(RAWVALUE)!.kinds[0]!;
}

/**
 * Problem of a card's (type, subtype) pair, or null: types with subtypes require one of theirs,
 * types without subtypes accept none.
 */
export function subtypeProblem(typeName: string | null | undefined, subtype: string | null | undefined): string | null {
  const type = typeOf(typeName);
  if (!type) return `unknown type-source "${typeName}"`;
  const isBlank = blank(subtype);
  if (!hasSubtypes(type)) return isBlank ? null : `${type.name} has no subtypes`;
  const list = subtypesOf(type).join(', ');
  if (isBlank) return `required for ${type.name} (${list})`;
  return subtypesOf(type).includes(subtype!) ? null : `unknown subtype "${subtype}" of ${type.name} (${list})`;
}

export const cardTypeOf = (typeName: string | null | undefined, subtype: string | null | undefined): CardType =>
  kindOrFallback(typeName, subtype).cardType;

export const languageOf = (typeName: string | null | undefined, subtype: string | null | undefined): string =>
  kindOrFallback(typeName, subtype).language;

export interface Size {
  width: number;
  height: number;
}

export function defaultSize(cardType: string): Size {
  switch (cardType) {
    case 'jsonassert':
      return { width: 300, height: 190 };
    case 'json':
      return { width: 290, height: 185 };
    case 'condition':
      return { width: 240, height: 165 };
    default:
      return { width: 320, height: 210 }; // request, query, js, sql
  }
}

export function defaultTimeout(cardType: string): number {
  switch (cardType) {
    case 'jsonassert':
    case 'json':
      return 2000;
    case 'condition':
      return 1000;
    default:
      return 5000; // request, query, js, sql
  }
}

/** Whether cards of this type name a source (`source: {type}/{name}`); false for rawvalue and jsonassert. */
export const hasSources = (typeName: string | null | undefined): boolean => typeOf(typeName)?.hasSources ?? false;
