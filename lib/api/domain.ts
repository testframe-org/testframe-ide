import * as Catalog from '../format/catalog';
import * as CodeRules from '../format/code-rules';
import * as MongoCall from '../format/mongo-call';

// Domain definitions served to the editor, which keeps no local copies: the catalog of source
// types with their card subtypes (GET /api/v2/catalog) and the code rules (POST /api/v2/validate).

/** One card kind of a type: `args` is the signature of a mongo call (empty otherwise). */
export interface CardKindEntry {
  subtype: string | null;
  cardType: Catalog.CardType;
  language: string;
  form: Catalog.FormKind;
  defaultWidth: number;
  defaultHeight: number;
  defaultTimeout: number;
  args: MongoCall.Arg[];
}

export interface SourceTypeEntry {
  name: string;
  language: string;
  hasSources: boolean;
  subtypes: string[];
  cards: CardKindEntry[];
}

export interface CatalogResponse {
  sourceTypes: SourceTypeEntry[];
  httpMethods: string[];
}

export function catalog(): CatalogResponse {
  return {
    sourceTypes: Catalog.TYPES.map((type) => ({
      name: type.name,
      language: type.language,
      hasSources: type.hasSources,
      subtypes: Catalog.subtypesOf(type),
      cards: type.kinds.map((kind) => {
        const size = Catalog.defaultSize(kind.cardType);
        return {
          subtype: kind.subtype,
          cardType: kind.cardType,
          language: kind.language,
          form: kind.form,
          defaultWidth: size.width,
          defaultHeight: size.height,
          defaultTimeout: Catalog.defaultTimeout(kind.cardType),
          args: type.name === 'mongo' ? MongoCall.signatureOf(kind.subtype) : []
        };
      })
    })),
    httpMethods: [...Catalog.HTTP_METHODS]
  };
}

/**
 * `problem`: the first problem (null when acceptable); `problems`: all of them (mongo: one per
 * argument); `formatted`: the canonical text the save would store (mongo, null otherwise).
 */
export interface ValidateResponse {
  problem: string | null;
  problems: string[];
  formatted: string | null;
}

export function validate(body: unknown): ValidateResponse {
  const b = (body ?? {}) as { sourceType?: string | null; subtype?: string | null; code?: string | null };
  const problems = CodeRules.problems(b.sourceType, b.subtype, b.code);
  return { problem: problems[0] ?? null, problems, formatted: CodeRules.formatted(b.sourceType, b.code) };
}
