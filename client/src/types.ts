// Derived from the source type (cardTypeOf), never stored: each family has its own type
export type CardType = 'request' | 'js' | 'sql' | 'jsonassert' | 'json' | 'validation';
export type CardStatus = 'idle' | 'running' | 'success' | 'error';
export type ResizeDirection = 'right' | 'bottom' | 'corner';
export type LogLevel = 'info' | 'success' | 'error';

export interface Card {
  id: string;
  title: string;
  varName?: string; // camelCase variable produced by this card (file name derives from it)
  type: CardType;
  width: number;
  height: number;
  timeout: number;
  status: CardStatus;
  endpoint: string;
  code: string;
  sourceType: string;
  sourceName: string;
  script?: string; // camelCase name of a script of the card's source; empty body on disk = inherit it
  resultHeight?: number; // px of the last-run panel under the script (absent = default)
  privateData?: string; // body of {var-file}.private.md (gitignored; falls back to .private.example.md)
  httpMethod: string;
}

// Outcome of executing one card (shown in the card editor and the console)
export interface CardRunResult {
  status: CardStatus;
  text: string; // one-line log
  output: string; // response / assertion result / simulated note
  at: string; // elapsed time label
  ranAt?: string; // ISO timestamp of the run
}

export interface Step {
  id: string;
  number: number;
  cards: Card[]; // execution order, left to right
}

export interface SourceScript {
  name: string; // camelCase, e.g. obterProdutosAtivos -> scripts/obter-produtos-ativos.md
  body: string; // the query/code itself
}

// GET/POST /api/v2/sources: the server reads/writes sources/{type}/{name}.md (+ .private.md, scripts)
export interface SourceDef {
  typeSource: string;
  name: string;
  baseUrl?: string;
  publicData: string;
  privateData: string;
  scripts?: SourceScript[]; // custom queries; swagger sources rely on the spec instead
}

export interface ExecLog {
  time: string;
  text: string;
  type: LogLevel;
}

export interface HttpResult {
  ok: boolean;
  status: number;
  statusText: string;
  ms: number;
  text: string;
}

export interface EndpointParts {
  method: string;
  path: string;
}

export interface SelectedContext {
  card: Card;
  stepId: string;
  stepNumber: number;
}

export interface FramesSaveResponse {
  project: string;
  root: string;
  saved: number;
}

// One flow on the canvas: frames/{name}/step-{n}/{var-file}.md
export interface Frame {
  name: string; // kebab-case directory name
  steps: Step[];
}

// --- Wire shapes of GET /api/v2/catalog (the server owns the domain definitions) ---
export interface CatalogEntry {
  name: string;
  cardType: CardType;
  language: string;
  hasScripts: boolean;
  defaultWidth: number;
  defaultHeight: number;
  defaultTimeout: number;
}

export interface CatalogResponse {
  sourceTypes: CatalogEntry[];
  httpMethods: string[];
  mongoOps: string[];
}

// --- Wire shapes of GET/POST /api/v2/frames (the server owns the .md format) ---
// type and httpMethod are derived by the server (ignored on save), as are step numbers
// (positions); the card sequence in a step comes from its flow.md. lastRun is the card's
// {var-file}.result-data.md.
export interface CardData {
  varName: string;
  title: string;
  type: string;
  sourceType: string;
  sourceName: string;
  script: string | null;
  endpoint: string;
  httpMethod: string;
  timeout: number | null;
  width: number | null;
  height: number | null;
  resultHeight: number | null;
  code: string;
  privateData: string | null;
  lastRun: CardRunData | null;
}

export interface CardRunData {
  status: CardStatus;
  text: string;
  output: string;
  at: string;
  ranAt?: string | null;
}

export interface StepData {
  number: number;
  cards: CardData[];
}

export interface FrameData {
  name: string;
  steps: StepData[];
}

export interface FramesLoadResponse {
  frames: FrameData[];
  errors: string[]; // invalid files and warnings (e.g. a missing source script)
}
