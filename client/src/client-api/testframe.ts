import type { ZodType } from 'zod';
import { requestJson } from './http';
import {
  catalogResponseSchema,
  cardRunResponseSchema,
  frameRunResponseSchema,
  framesLoadResponseSchema,
  framesSaveResponseSchema,
  healthResponseSchema,
  openApiSpecSchema,
  projectSummarySchema,
  sourcesLoadResponseSchema,
  validateResponseSchema
} from './testframe.z';
import type { CardData, CardRunResult, FrameData, SourceDef, StepData } from './testframe.z';

// Every shape lives in ./testframe.z; re-export the response types so consumers can
// import them from the api module (../client-api) as before.
export type {
  CardRunOutcome,
  CardRunResponse,
  CatalogResponse,
  FrameRunResponse,
  FramesLoadResponse,
  FramesSaveResponse,
  HealthResponse,
  OpenApiSpec,
  ProjectSummary,
  SourcesLoadResponse,
  ValidateResponse
} from './testframe.z';

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body)
});

// One JSON call, answered through its zod schema: nothing crosses the wire unchecked
const call = <T>(schema: ZodType<T>, path: string, init?: RequestInit): Promise<T> =>
  requestJson<unknown>(path, init).then((data) => schema.parse(data));

// Framework API (testframe-server)
export const testframeApi = {
  health: () => call(healthResponseSchema, '/api/v2/health'),

  // Source types with their subtypes: card type, fence language, form, defaults; HTTP methods
  loadCatalog: () => call(catalogResponseSchema, '/api/v2/catalog'),

  // The server's code rule for a (type, subtype) (null = acceptable)
  validateCode: (sourceType: string, subtype: string | undefined, code: string) =>
    call(validateResponseSchema, '/api/v2/validate', json('POST', { sourceType, subtype: subtype ?? null, code }))
      .then((r) => r.problem ?? null),

  // The cached operations of an openapi source ({name}.cache.md; fetched once when missing)
  loadOperations: (project: string, source: string) =>
    call(openApiSpecSchema, `/api/v2/sources/openapi/${encodeURIComponent(source)}/operations?project=${encodeURIComponent(project)}`),

  // Fetches the source's spec again and rewrites its cache
  refreshOperations: (project: string, source: string) =>
    call(openApiSpecSchema,
      `/api/v2/sources/openapi/${encodeURIComponent(source)}/operations/refresh?project=${encodeURIComponent(project)}`,
      json('POST', {})),

  listProjects: () => call(projectSummarySchema.array(), '/api/v2/projects'),

  // Replaces frames/{slug(frame.name)}/ (validated and serialized by the server; 400 with the reason)
  saveFrames: (project: string, frame: FrameData) =>
    call(framesSaveResponseSchema, '/api/v2/frames', json('POST', { project, frame })),

  // Stores a card's last run next to it ({var-file}.cache.md, gitignored)
  saveResult: (project: string, frame: string, step: number, varName: string, result: CardRunResult) =>
    call(framesSaveResponseSchema, '/api/v2/frames/results', json('POST', { project, frame, step, varName, result })),

  loadFrames: (project: string) => call(framesLoadResponseSchema, `/api/v2/frames/${encodeURIComponent(project)}`),

  // Each sent source replaces its files and script folder (validated by the server; 400 with the reason)
  saveSources: (project: string, sources: SourceDef[]) =>
    call(framesSaveResponseSchema, '/api/v2/sources', json('POST', { project, sources })),

  // Deletes one source with its private/cache files (404 when not on disk, 409 listing the cards that use it)
  deleteSource: (project: string, type: string, name: string) =>
    requestJson<void>(
      `/api/v2/sources/${encodeURIComponent(type)}/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`,
      { method: 'DELETE' }
    ),

  loadSources: (project: string) => call(sourcesLoadResponseSchema, `/api/v2/sources/${encodeURIComponent(project)}`),

  // Runs the whole frame on the server: cards execute in the sent order (steps, then the
  // step's array order), bindings and HTTP requests included, stopping at the first error card
  runFrame: (project: string, frame: string, steps: StepData[]) =>
    call(frameRunResponseSchema, '/api/v2/run', json('POST', { project, frame, steps })),

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
  ) => call(cardRunResponseSchema, '/api/v2/run/card', json('POST', { project, step, card, vars, payload, resultCard }))
};
