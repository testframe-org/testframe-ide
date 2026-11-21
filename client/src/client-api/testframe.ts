import type { FrameFile, FramesLoadResponse, FramesSaveResponse, RawSource, SourceDef, WrappedSource } from '../types';
import { requestJson } from './http';

export interface HealthResponse {
  status: string;
  service?: string;
  servico?: string;
}

export interface SourcesLoadResponse {
  project: string;
  root: string;
  sources?: RawSource[];
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body)
});

// Framework API (testframe-server)
export const testframeApi = {
  health: () => requestJson<HealthResponse>('/api/v2/health'),

  echo: (payload: unknown) =>
    requestJson<Record<string, unknown>>('/api/v2/echo', json('POST', payload)),

  // Replaces frames/{frame}/ with `files` (paths relative to frames/, e.g. main/step-1/x.md)
  saveFrames: (project: string, frame: string, files: FrameFile[]) =>
    requestJson<FramesSaveResponse>('/api/v2/frames', json('POST', { project, frame, files })),

  loadFrames: (project: string) =>
    requestJson<FramesLoadResponse>(`/api/v2/frames/${encodeURIComponent(project)}`),

  saveSources: (project: string, sources: WrappedSource[]) =>
    requestJson<FramesSaveResponse>('/api/v2/sources', json('POST', { project, sources })),

  loadSources: (project: string) =>
    requestJson<SourcesLoadResponse>(`/api/v2/sources/${encodeURIComponent(project)}`)
};
