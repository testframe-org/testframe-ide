import type { CatalogResponse, ValidateResponse } from '@/lib/api/domain';
import type { Card, CardRun, Frame, FramesResponse, Step } from '@/lib/format/types';
import type { OpenApiSpec } from '@/lib/openapi/openapi-spec';
import type { RunnerHealth } from '@/lib/services/runner-client';
import type { SourcesResponse } from '@/lib/services/source-service';
import type { SourcesSaveResponse } from '@/lib/services/sources-save';
import type { SourcesModel } from '@/lib/sources/sources-yaml';
import type { ProjectSummary, SaveResult } from '@/lib/store/project-store';
import { ApiError, requestJson } from './http';

// The editor's only network surface: every call goes to this module's own route handlers
// (app/api/v2/*), which exchange JSON. The response types are imported from lib/ so the editor
// keeps no second copy of a shape; the run answers come from the execution plugin and follow
// docs/runner-protocol.md, which the IDE routes pass through unchanged.

const enc = encodeURIComponent;
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** GET /api/v2/health: the IDE is up, plus how it sees the execution plugin. */
export interface HealthResponse {
  status: string;
  service: string;
  runner: RunnerHealth;
}

/** One card's outcome in a run (docs/runner-protocol.md, "CardResult"). */
export interface CardResult {
  varName: string;
  status: 'success' | 'error' | 'skipped';
  text: string;
  output: string;
  ranAt: string;
  offsetMs: number;
  elapsedMs: number;
  /** Set only when the run rewrote this card's body (the JSON card that received a response). */
  code: string | null;
  /** On `skipped` cards: the var-name of the conditional that evaluated to false. */
  skippedBy: string | null;
  /** Structured evidence; the editor shows `output` and leaves the detail to the tour. */
  detail?: Record<string, unknown>;
}

/** POST /api/v2/run/card. */
export interface CardRunResponse {
  result: CardResult;
  vars: Record<string, unknown>;
}

/** The NDJSON events of a streamed frame run; unknown events are ignored by the caller. */
export type RunEvent =
  | { event: 'frame-started'; frame?: string; environment?: string }
  | { event: 'card-started'; step?: number; varName?: string }
  | { event: 'card-finished'; step?: number; result: CardResult }
  | {
      event: 'frame-finished';
      status?: string;
      stopped?: string | null;
      elapsedMs?: number;
      vars?: Record<string, unknown>;
      counts?: Record<string, number>;
    }
  | { event: 'error'; message?: string };

export const NDJSON = 'application/x-ndjson';

export const ideApi = {
  health: () => requestJson<HealthResponse>('/api/v2/health'),

  /** Forces a fresh plugin health check (GET /api/v2/runner). */
  runnerHealth: () => requestJson<RunnerHealth>('/api/v2/runner'),

  /** Source types with their subtypes, card kinds, defaults and the mongo signatures. */
  catalog: () => requestJson<CatalogResponse>('/api/v2/catalog'),

  projects: () => requestJson<ProjectSummary[]>('/api/v2/projects'),

  /** The project's frames, with each card's last run in `env`. */
  loadFrames: (project: string, env: string | null) =>
    requestJson<FramesResponse>(`/api/v2/frames/${enc(project)}${env ? `?env=${enc(env)}` : ''}`),

  /** Replaces frames/{slug(frame.name)}/ (400 with every problem). */
  saveFrame: (project: string, frame: Frame) => requestJson<SaveResult>('/api/v2/frames', post({ project, frame })),

  /** Stores a card's last run in .testframebuild/, per environment. */
  saveResult: (project: string, environment: string, frame: string, step: number, varName: string, result: CardRun) =>
    requestJson<{ project: string; saved: number }>('/api/v2/results', post({ project, environment, frame, step, varName, result })),

  /** The sources*.yaml layers of a project (base, private and per environment). */
  loadSources: (project: string) => requestJson<SourcesResponse>(`/api/v2/sources/${enc(project)}`),

  /** Rewrites the layers; `env` is the environment whose openapi operations get refreshed. */
  saveSources: (project: string, model: SourcesModel, env: string | null) =>
    requestJson<SourcesSaveResponse>('/api/v2/sources', post({
      project,
      environments: model.environments,
      layers: model.layers,
      ...(env ? { env } : {})
    })),

  /** The openapi source's cached operations for an environment. */
  operations: (project: string, name: string, env: string | null) =>
    requestJson<OpenApiSpec>(`/api/v2/sources/openapi/${enc(name)}/operations?project=${enc(project)}${env ? `&env=${enc(env)}` : ''}`),

  /** Fetches the spec again and rewrites that environment's cache. */
  refreshOperations: (project: string, name: string, env: string | null) =>
    requestJson<OpenApiSpec>(
      `/api/v2/sources/openapi/${enc(name)}/operations/refresh?project=${enc(project)}${env ? `&env=${enc(env)}` : ''}`,
      post({})
    ),

  /** The code rule of a (type, subtype): the first problem, all of them, and the canonical text. */
  validate: (sourceType: string, subtype: string | undefined, code: string) =>
    requestJson<ValidateResponse>('/api/v2/validate', post({ sourceType, subtype: subtype ?? null, code })),

  /** Runs one card with the variables the editor already has. */
  runCard: (
    project: string,
    environment: string,
    step: number,
    card: Card,
    vars: Record<string, unknown>,
    payload: string | null,
    resultCard: { varName: string; code: string } | null
  ) => requestJson<CardRunResponse>('/api/v2/run/card', post({ project, environment, step, card, vars, payload, resultCard }))
};

/**
 * Runs a frame through the plugin, streaming the NDJSON events through the IDE route.
 * Resolves once the stream ends; a non-2xx answer (the plugin down: 503) throws an ApiError
 * before the first event, since request-level problems are detected up front.
 */
export async function runFrameStream(
  body: { project: string; frame: string; environment: string; steps: Step[]; deadlineMs?: number },
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/v2/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: NDJSON },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    throw new ApiError(0, `the IDE did not answer: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    let problems: string[] = [];
    try {
      const parsed = JSON.parse(text) as { message?: unknown; problems?: unknown };
      if (typeof parsed.message === 'string') message = parsed.message;
      if (Array.isArray(parsed.problems)) problems = parsed.problems.filter((p): p is string => typeof p === 'string');
    } catch {
      /* not JSON: show the raw text */
    }
    throw new ApiError(res.status, `${res.status} ${message}`.trim(), message, problems);
  }
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) emit(line, onEvent);
        newline = buffer.indexOf('\n');
      }
    }
  } catch (e) {
    // A cancelled run stops mid-stream; the events seen so far already reached the canvas.
    if ((e as Error).name !== 'AbortError') throw e;
    return;
  }
  const tail = buffer.trim();
  if (tail) emit(tail, onEvent);
}

function emit(line: string, onEvent: (event: RunEvent) => void): void {
  try {
    onEvent(JSON.parse(line) as RunEvent);
  } catch {
    /* a partial or non-JSON line carries no event */
  }
}
