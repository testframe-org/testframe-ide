import type { CardData, CardRunResult, CatalogResponse, FrameData, FramesLoadResponse, FramesSaveResponse, SourceDef, StepData } from '../types';
import { requestJson } from './http';

export interface HealthResponse {
  status: string;
  service?: string;
  servico?: string;
}

// GET /api/v2/projects: folders with testframe/ under the projects dir, most recent first
export interface ProjectSummary {
  name: string;
  frames: number;
  sources: number;
  lastModified: string; // ISO instant
}

// POST /api/v2/run and /api/v2/run/card: the server-side card runner ({{bindings}}, HTTP
// requests, mongo scripts, assertions). One outcome per executed card; `code` is set when the
// run rewrote that card's body (the JSON result card that received a response), and `vars`
// carries every variable the run published.
export interface CardRunOutcome {
  varName: string;
  status: 'success' | 'error';
  text: string;
  output: string;
  at: string;
  ranAt: string;
  code: string | null;
}

export interface FrameRunResponse {
  project: string;
  frame: string;
  results: CardRunOutcome[];
  vars: Record<string, unknown>;
}

export interface CardRunResponse {
  result: CardRunOutcome;
  vars: Record<string, unknown>;
}

export interface SourcesLoadResponse {
  sources: SourceDef[];
}

// POST /api/v2/validate: the server's code rule for a source type (null = acceptable)
export interface ValidateResponse {
  problem: string | null;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body)
});

// Framework API (testframe-server)
export const testframeApi = {
  health: () => requestJson<HealthResponse>('/api/v2/health'),

  // Source types, card types, fence language, defaults, HTTP methods and mongo ops (Phase 2)
  loadCatalog: () => requestJson<CatalogResponse>('/api/v2/catalog'),

  validateCode: async (sourceType: string, code: string): Promise<string | null> =>
    (await requestJson<ValidateResponse>('/api/v2/validate', json('POST', { sourceType, code }))).problem,

  listProjects: () => requestJson<ProjectSummary[]>('/api/v2/projects'),

  // Replaces frames/{slug(frame.name)}/ (validated and serialized by the server; 400 with the reason)
  saveFrames: (project: string, frame: FrameData) =>
    requestJson<FramesSaveResponse>('/api/v2/frames', json('POST', { project, frame })),

  // Stores a card's last run next to it ({var-file}.result-data.md, gitignored)
  saveResult: (project: string, frame: string, step: number, varName: string, result: CardRunResult) =>
    requestJson<FramesSaveResponse>('/api/v2/frames/results', json('POST', { project, frame, step, varName, result })),

  loadFrames: (project: string) =>
    requestJson<FramesLoadResponse>(`/api/v2/frames/${encodeURIComponent(project)}`),

  // Each sent source replaces its files and script folder (validated by the server; 400 with the reason)
  saveSources: (project: string, sources: SourceDef[]) =>
    requestJson<FramesSaveResponse>('/api/v2/sources', json('POST', { project, sources })),

  loadSources: (project: string) =>
    requestJson<SourcesLoadResponse>(`/api/v2/sources/${encodeURIComponent(project)}`),

  // Runs the whole frame on the server: cards execute in the sent order (steps, then the
  // step's array order), bindings and HTTP requests included, stopping at the first error card
  runFrame: (project: string, frame: string, steps: StepData[]) =>
    requestJson<FrameRunResponse>('/api/v2/run', json('POST', { project, frame, steps })),

  // Runs one card (the card editor's Run button) with the variables the editor already has.
  // `payload` is the code of the nearest JSON card before it; `resultCard` the first JSON card
  // after it: a successful run publishes its variable and the editor rewrites the card from it
  runCard: (
    project: string,
    step: number,
    card: CardData,
    vars: Record<string, unknown>,
    payload: string | null,
    resultCard: { varName: string; code: string } | null
  ) => requestJson<CardRunResponse>('/api/v2/run/card', json('POST', { project, step, card, vars, payload, resultCard }))
};
