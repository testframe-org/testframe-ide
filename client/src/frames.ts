import type { Card, CardData, CardRunResult, CardType, Frame, FrameData, FramesLoadResponse, Step } from './types';
import { DEFAULT_CARD_SIZE, DEFAULT_TIMEOUT } from './catalog';

// ============================================================================
// The project format (.md files, frontmatter, file names, script inheritance,
// what is stored) is owned by the framework server (server/.../format, spec:
// modules/testframe-ide/docs/project-format.md). The domain definitions —
// source types, card types, defaults, HTTP methods and the code rules per
// source type — are served too (GET /api/v2/catalog, POST /api/v2/validate;
// see catalog.ts). This module keeps the editor's in-memory model and the name
// helpers used for live feedback (a mirror of the server's format/Names, the
// server enforces them on save). Execution is a server concern since phase 3:
// {{bindings}}, HTTP requests, mongo scripts and assertions run through
// POST /api/v2/run and POST /api/v2/run/card.
// ============================================================================

// Frame used when a project has none yet
export const DEFAULT_FRAME = 'main';

// --- NAMES (mirror of the server's format/Names: the server enforces them on save; the editor
// uses them for new cards, the storage directory and live var-name feedback) ---
export const slug = (text: string): string =>
  String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

// Variable name (camelCase) from a human title, e.g. 'Get active products' -> getActiveProducts
export const toVarName = (text: string): string => {
  const words = slug(text).split('-').filter(Boolean);
  return words
    .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join('');
};

// File name is the kebab-case of the variable, e.g. getActiveProducts -> get-active-products
export const varNameToFileName = (varName: string): string =>
  varName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '') || 'card';

// Reverse of varNameToFileName: get-active-products -> getActiveProducts
export const fileNameToVarName = (fileName: string): string => toVarName(fileName.replace(/\.md$/, ''));

// Coerces user input into a var-name that survives the file-name round trip
// (camelCase, no consecutive capitals): 'getHTTP data' -> getHttpData
export const normalizeVarName = (input: string): string => fileNameToVarName(varNameToFileName(input));

// --- HELPERS ---

// The frame to show: the requested one when it exists, else the first on disk
export const pickFrame = (frames: Frame[], preferred?: string): Frame | undefined =>
  frames.find((f) => f.name === slug(preferred ?? '')) ?? frames[0];

// --- IN-MEMORY MODEL <-> API (GET/POST /api/v2/frames) ---
export const cardVarName = (card: Pick<Card, 'varName' | 'title'>): string => card.varName || toVarName(card.title);

// Card ids are editor-only: {frame}/step-{n}/{var-file}
const toCard = (frame: string, stepNumber: number, d: CardData): Card => ({
  id: `${frame}/step-${stepNumber}/${varNameToFileName(d.varName)}`,
  title: d.title,
  varName: d.varName,
  type: d.type as CardType,
  width: d.width ?? DEFAULT_CARD_SIZE[d.type as CardType].width,
  height: d.height ?? DEFAULT_CARD_SIZE[d.type as CardType].height,
  timeout: d.timeout ?? DEFAULT_TIMEOUT[d.type as CardType],
  status: 'idle',
  endpoint: d.endpoint ?? '',
  code: d.code ?? '',
  sourceType: d.sourceType ?? 'inline',
  sourceName: d.sourceName ?? '',
  script: d.script ?? undefined,
  resultHeight: d.resultHeight ?? undefined,
  privateData: d.privateData ?? undefined,
  httpMethod: d.httpMethod ?? ''
});

// Frames as loaded by the server, with the last run of each card keyed by card id
export const framesFromApi = (
  data: FramesLoadResponse
): { frames: Frame[]; errors: string[]; results: Record<string, CardRunResult> } => {
  const results: Record<string, CardRunResult> = {};
  const frames = data.frames.map((frame) => ({
    name: frame.name,
    steps: frame.steps.map((step, idx) => ({
      id: `step-${idx + 1}`,
      number: idx + 1,
      cards: step.cards.map((d) => {
        const card = toCard(frame.name, idx + 1, d);
        if (d.lastRun) {
          const { status, text, output, at, ranAt } = d.lastRun;
          results[card.id] = { status, text, output, at, ranAt: ranAt ?? undefined };
        }
        return card;
      })
    }))
  }));
  return { frames, errors: data.errors ?? [], results };
};

// One card for the frame API and the runner (POST /api/v2/frames, /api/v2/run, /api/v2/run/card).
export const cardToApi = (card: Card): CardData => ({
  varName: cardVarName(card),
  title: card.title,
  type: card.type,
  sourceType: card.sourceType,
  sourceName: card.sourceName,
  script: card.script ?? null,
  endpoint: card.endpoint,
  httpMethod: card.httpMethod,
  timeout: card.timeout,
  width: card.width,
  height: card.height,
  resultHeight: card.resultHeight ?? null,
  code: card.code,
  privateData: card.privateData ?? null,
  lastRun: null
});

// One frame for POST /api/v2/frames: the server numbers steps by position, stores the card
// sequence in the step's flow.md, validates var-names, the frontmatter and the code rules,
// and stores inherited script bodies empty.
export const frameToApi = (name: string, steps: Step[]): FrameData => ({
  name,
  steps: steps.map((step, idx) => ({
    number: idx + 1,
    cards: step.cards.map(cardToApi)
  }))
});
