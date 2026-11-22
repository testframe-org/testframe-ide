import type { CardRunResult, FrameData, FramesLoadResponse, FramesSaveResponse, SourceDef } from '../types';
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

// POST /api/v2/run/mongo: a mongo source script executed by the framework server
export interface MongoRunResponse {
  operation: string;
  collection: string;
  count: number;
  result: unknown;
}

export interface SourcesLoadResponse {
  sources: SourceDef[];
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body)
});

// Framework API (testframe-server)
export const testframeApi = {
  health: () => requestJson<HealthResponse>('/api/v2/health'),

  listProjects: () => requestJson<ProjectSummary[]>('/api/v2/projects'),

  echo: (payload: unknown) =>
    requestJson<Record<string, unknown>>('/api/v2/echo', json('POST', payload)),

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

  // Runs a read-only mongo script (db.<collection>.find|findOne|aggregate|countDocuments|distinct).
  // The server reads the connection from the project's sources/mongo/{source}.md (base-url).
  runMongo: (project: string, source: string, script: string, timeoutMs?: number) =>
    requestJson<MongoRunResponse>('/api/v2/run/mongo', json('POST', { project, source, script, timeoutMs }))
};
