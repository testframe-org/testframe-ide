import type { CardType, FormKind } from '@/lib/format/catalog';
import type { CardRun } from '@/lib/format/types';

// The editor's in-memory model. It is not the project format: the wire shapes of the editing API
// live in lib/format/types.ts (Card, Step, Frame, CardRun) and editor/frames.ts maps between the
// two. Cards carry an editor-only `id` ({frame}/step-{n}/{var-file}) and a live `status`.

export type { CardType, FormKind };

/** A card's state on the canvas: the stored run statuses plus `running` while it executes. */
export type CardStatus = CardRun['status'] | 'running';

/** One card as the canvas holds it. Identity on disk: frames/{frame}/step-{n}/{var-file}.md. */
export interface EditorCard {
  /** Editor-only: `{frame}/step-{n}/{var-file}` (stable across loads while the var-name holds). */
  id: string;
  title: string;
  /** camelCase var-name; derived from the title while absent. */
  varName?: string;
  /** Derived from (sourceType, subtype) by the catalog; drives defaults and the card's look. */
  type: CardType;
  width: number;
  height: number;
  timeout: number;
  status: CardStatus;
  endpoint: string;
  /** openapi cards: the operationId of the picked operation (the operation's identity). */
  openapiId?: string;
  code: string;
  /** Type-source; '' while the card is a draft (the editor asks for it first). */
  sourceType: string;
  subtype?: string;
  /** mongo cards: the collection the call works on. */
  collection?: string;
  sourceName: string;
  /** px of the last-run panel under the code (absent = default). */
  resultHeight?: number;
  /** Body of {var-file}.private.md: this card's own notes, gitignored, never sent to the plugin. */
  privateData?: string;
  /** Derived from the endpoint; kept for display only. */
  httpMethod: string;
}

/** One step: an ordered sequence of cards, executed left to right. */
export interface EditorStep {
  /** Editor-only, stable across renumbering. */
  id: string;
  number: number;
  cards: EditorCard[];
}

/** One flow on the canvas: frames/{name}/step-{n}/{var-file}.md. */
export interface EditorFrame {
  name: string;
  steps: EditorStep[];
}

/** A card's last run in the current environment, as shown on the canvas and in the editor. */
export interface CardRunView {
  status: CardRun['status'];
  text: string;
  output: string;
  elapsedMs: number | null;
  ranAt: string | null;
}

export type LogLevel = 'info' | 'success' | 'error';

/** One line of the floating execution console. */
export interface ExecLog {
  time: string;
  text: string;
  type: LogLevel;
}

export type ResizeDirection = 'right' | 'bottom' | 'corner';

/** The card open in the editor, with the step that holds it. */
export interface SelectedContext {
  card: EditorCard;
  stepId: string;
  stepNumber: number;
}

/** Milliseconds as the console and the last-run panels show them. */
export function formatElapsed(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
