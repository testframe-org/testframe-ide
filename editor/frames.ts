import * as Names from '@/lib/format/names';
import type { Card, CardRun, Frame, FramesResponse } from '@/lib/format/types';
import { defaultSize, defaultTimeout, cardTypeOf } from './catalog';
import type { CardRunView, EditorCard, EditorFrame, EditorStep } from './types';

// The editor's in-memory model against the editing API (GET/POST /api/v2/frames). The project
// format itself — file names, frontmatter, the fenced body, what is stored and what is derived —
// is owned by lib/format (spec: agents/specs/project-format.md) and enforced by the IDE on save; the
// naming rules are imported from lib/format/names rather than mirrored here.

/** Frame shown when a project has none yet. */
export const DEFAULT_FRAME = 'main';

export const slug = Names.slug;
export const toVarName = Names.toVarName;
export const varNameToFileName = Names.varNameToFileName;
export const normalizeVarName = Names.normalizeVarName;

/** Var-name of a card: its own, or derived from its title. */
export const cardVarName = (card: Pick<EditorCard, 'varName' | 'title'>): string => card.varName || Names.toVarName(card.title);

/** The frame to show: the requested one when it exists, else the first on disk. */
export const pickFrame = (frames: EditorFrame[], preferred?: string): EditorFrame | undefined =>
  frames.find((f) => f.name === Names.slug(preferred ?? '')) ?? frames[0];

const orEmpty = (s: string | null | undefined): string => s ?? '';

/** One card as the API sent it, with the catalog's defaults filled in. */
function toCard(frame: string, stepNumber: number, d: Card): EditorCard {
  const varName = orEmpty(d.varName) || Names.toVarName(orEmpty(d.title));
  const type = cardTypeOf(orEmpty(d.sourceType), d.subtype ?? undefined);
  const size = defaultSize(type);
  return {
    id: `${frame}/step-${stepNumber}/${Names.varNameToFileName(varName)}`,
    title: orEmpty(d.title) || varName,
    varName: varName || undefined,
    type,
    width: d.width ?? size.width,
    height: d.height ?? size.height,
    timeout: d.timeout ?? defaultTimeout(type),
    status: 'idle',
    endpoint: orEmpty(d.endpoint),
    openapiId: d.openapiId ?? undefined,
    code: orEmpty(d.code),
    sourceType: orEmpty(d.sourceType),
    subtype: d.subtype ?? undefined,
    collection: d.collection ?? undefined,
    sourceName: orEmpty(d.sourceName),
    resultHeight: d.resultHeight ?? undefined,
    privateData: d.privateData ?? undefined,
    httpMethod: orEmpty(d.httpMethod)
  };
}

const toRunView = (run: CardRun): CardRunView => ({
  status: run.status,
  text: run.text,
  output: run.output,
  elapsedMs: run.elapsedMs ?? null,
  ranAt: run.ranAt ?? null
});

/** The frames of a load answer, plus each card's last run keyed by its editor id. */
export function framesFromApi(data: FramesResponse): {
  frames: EditorFrame[];
  errors: string[];
  results: Record<string, CardRunView>;
} {
  const results: Record<string, CardRunView> = {};
  const frames = (data.frames ?? []).map((frame) => ({
    name: frame.name,
    steps: (frame.steps ?? []).map((step, index) => {
      const number = step.number ?? index + 1;
      const editorStep: EditorStep = {
        id: `step-${frame.name}-${number}`,
        number,
        cards: (step.cards ?? []).map((d) => {
          const card = toCard(frame.name, number, d);
          if (d.lastRun) results[card.id] = toRunView(d.lastRun);
          return card;
        })
      };
      return editorStep;
    })
  }));
  return { frames, errors: data.errors ?? [], results };
}

/**
 * One card for POST /api/v2/frames and for the run routes. Derived (`type`, `httpMethod`) and
 * run (`lastRun`) fields are left out: the IDE derives them from (sourceType, subtype) and the
 * endpoint. A card's private notes travel with it (they are saved, never run).
 */
export const cardToApi = (card: EditorCard): Card => ({
  varName: cardVarName(card),
  title: card.title,
  sourceType: card.sourceType,
  subtype: card.subtype ?? null,
  collection: card.collection || null,
  sourceName: card.sourceName,
  endpoint: card.endpoint,
  openapiId: card.openapiId ?? null,
  timeout: card.timeout,
  width: card.width,
  height: card.height,
  resultHeight: card.resultHeight ?? null,
  code: card.code,
  privateData: card.privateData ?? null
});

/** One frame for POST /api/v2/frames: steps are numbered by position, the IDE writes the flow. */
export const frameToApi = (name: string, steps: EditorStep[]): Frame => ({
  name,
  steps: steps.map((step, index) => ({ number: index + 1, cards: step.cards.map(cardToApi) }))
});

/** A card's run as stored per environment (POST /api/v2/results). */
export const toCardRun = (run: CardRunView): CardRun => ({
  status: run.status,
  text: run.text,
  output: run.output,
  elapsedMs: run.elapsedMs,
  ranAt: run.ranAt
});
