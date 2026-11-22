// Wire shapes of the editing API (JSON). The server builds every path and file from them.

/** Last run of a card in one environment (kept in .testframebuild/). */
export interface CardRun {
  status: 'idle' | 'success' | 'error' | 'skipped';
  /** One-line summary (the run's `text`). */
  text: string;
  output: string;
  elapsedMs?: number | null;
  ranAt?: string | null;
}

/**
 * One card as exchanged with the editor. Identity on disk is
 * `frames/{frame}/step-{n}/{var-file}.md`; `type` and `httpMethod` are derived (from (sourceType,
 * subtype) and the endpoint) and ignored on save, as is `lastRun`. Null timeout/width/height mean
 * the card type's defaults.
 */
export interface Card {
  varName?: string | null;
  title?: string | null;
  type?: string | null;
  sourceType?: string | null;
  subtype?: string | null;
  collection?: string | null;
  sourceName?: string | null;
  endpoint?: string | null;
  openapiId?: string | null;
  httpMethod?: string | null;
  timeout?: number | null;
  width?: number | null;
  height?: number | null;
  resultHeight?: number | null;
  code?: string | null;
  privateData?: string | null;
  lastRun?: CardRun | null;
}

export interface Step {
  number?: number | null;
  cards?: Card[] | null;
}

export interface Frame {
  name: string;
  steps?: Step[] | null;
}

export interface FramesResponse {
  frames: Frame[];
  errors: string[];
}

/** One project file: `path` relative to the directory it was listed from. */
export interface ProjectFile {
  path: string;
  content: string;
}
