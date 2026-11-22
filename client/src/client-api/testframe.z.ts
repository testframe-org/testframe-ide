import { z } from 'zod';

// ============================================================================
// THE ONE zod file of the client: every shape (editor model, frames/sources
// wire shapes, framework API responses) is defined here as a schema, and the
// types are inferred from it; the endpoint helpers in testframe.ts parse every
// response against these schemas, so nothing crosses the wire unchecked.
// ============================================================================

// --- Editor model ---

// Derived from (type-source, subtype) (cardKindOf), never stored: each family has its own type
export const cardTypeSchema = z.enum(['request', 'query', 'js', 'sql', 'jsonassert', 'condition', 'json']);
export type CardType = z.infer<typeof cardTypeSchema>;

// skipped: the card came after a false jsonassert conditional in its step
export const cardStatusSchema = z.enum(['idle', 'running', 'success', 'error', 'skipped']);
export type CardStatus = z.infer<typeof cardStatusSchema>;

export const resizeDirectionSchema = z.enum(['right', 'bottom', 'corner']);
export type ResizeDirection = z.infer<typeof resizeDirectionSchema>;

export const logLevelSchema = z.enum(['info', 'success', 'error']);
export type LogLevel = z.infer<typeof logLevelSchema>;

// The in-memory card (editor state). Identity on disk: {frame}/step-{n}/{var-file}.md
export const cardSchema = z.object({
  id: z.string(),
  title: z.string(),
  varName: z.string().optional(), // camelCase variable produced by this card (file name derives from it)
  type: cardTypeSchema,
  width: z.number(),
  height: z.number(),
  timeout: z.number(),
  status: cardStatusSchema,
  endpoint: z.string(),
  openapiId: z.string().optional(), // openapi cards: the spec operation's operationId (the operation identity)
  code: z.string(),
  sourceType: z.string(), // type-source: every saved card declares one ('rawvalue' when it has no source)
  subtype: z.string().optional(), // set when the type has subtypes (e.g. mongo: find | aggregation)
  collection: z.string().optional(), // mongo cards: the collection the query reads (frontmatter collection:)
  sourceName: z.string(),
  resultHeight: z.number().optional(), // px of the last-run panel under the script (absent = default)
  privateData: z.string().optional(), // body of {var-file}.private.md (gitignored; absent file = none)
  httpMethod: z.string()
});
export type Card = z.infer<typeof cardSchema>;

// Outcome of executing one card (shown in the card editor and the console)
export const cardRunResultSchema = z.object({
  status: cardStatusSchema,
  text: z.string(), // one-line log
  output: z.string(), // response / assertion result payload
  at: z.string(), // elapsed time label
  ranAt: z.string().optional() // ISO timestamp of the run
});
export type CardRunResult = z.infer<typeof cardRunResultSchema>;

export const stepSchema = z.object({
  id: z.string(),
  number: z.number(),
  cards: z.array(cardSchema) // execution order, left to right
});
export type Step = z.infer<typeof stepSchema>;

// One flow on the canvas: frames/{name}/step-{n}/{var-file}.md
export const frameSchema = z.object({
  name: z.string(), // kebab-case directory name
  steps: z.array(stepSchema)
});
export type Frame = z.infer<typeof frameSchema>;

export const execLogSchema = z.object({
  time: z.string(),
  text: z.string(),
  type: logLevelSchema
});
export type ExecLog = z.infer<typeof execLogSchema>;

export const selectedContextSchema = z.object({
  card: cardSchema,
  stepId: z.string(),
  stepNumber: z.number()
});
export type SelectedContext = z.infer<typeof selectedContextSchema>;

// --- Wire shapes of GET/POST /api/v2/sources ---
// A source is only its connection: sources/{typeSource}/{name}.md holds base-url and nothing
// else, {name}.private.md the private data (gitignored). Card code always lives in the card.
export const sourceDefSchema = z.object({
  typeSource: z.string(),
  name: z.string(),
  baseUrl: z.string().nullish(),
  privateData: z.string()
});
export type SourceDef = z.infer<typeof sourceDefSchema>;

export const sourcesLoadResponseSchema = z.object({
  sources: z.array(sourceDefSchema),
  errors: z.array(z.string()) // invalid source files (skipped)
});
export type SourcesLoadResponse = z.infer<typeof sourcesLoadResponseSchema>;

// --- Wire shapes of GET/POST /api/v2/frames (the server owns the .md format) ---
// type and httpMethod are derived by the server (ignored on save), as are step numbers
// (positions); the card sequence in a step comes from its flow.md. lastRun is the card's
// {var-file}.cache.md.
export const cardRunDataSchema = z.object({
  status: cardStatusSchema,
  text: z.string(),
  output: z.string(),
  at: z.string(),
  ranAt: z.string().nullish()
});
export type CardRunData = z.infer<typeof cardRunDataSchema>;

export const cardDataSchema = z.object({
  varName: z.string(),
  title: z.string(),
  type: z.string(),
  sourceType: z.string(),
  subtype: z.string().nullish(),
  collection: z.string().nullish(),
  sourceName: z.string(),
  endpoint: z.string(),
  openapiId: z.string().nullish(),
  httpMethod: z.string(),
  timeout: z.number().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  resultHeight: z.number().nullish(),
  code: z.string(),
  privateData: z.string().nullish(),
  lastRun: cardRunDataSchema.nullish()
});
export type CardData = z.infer<typeof cardDataSchema>;

export const stepDataSchema = z.object({
  number: z.number(),
  cards: z.array(cardDataSchema)
});
export type StepData = z.infer<typeof stepDataSchema>;

export const frameDataSchema = z.object({
  name: z.string(),
  steps: z.array(stepDataSchema)
});
export type FrameData = z.infer<typeof frameDataSchema>;

export const framesLoadResponseSchema = z.object({
  frames: z.array(frameDataSchema),
  errors: z.array(z.string()) // invalid files and warnings (e.g. a missing source script)
});
export type FramesLoadResponse = z.infer<typeof framesLoadResponseSchema>;

// Save acks of POST /api/v2/frames, /frames/results and /sources
export const framesSaveResponseSchema = z.object({
  project: z.string(),
  root: z.string(),
  saved: z.number(),
  warnings: z.array(z.string()).optional() // sources save: openapi specs that could not be cached
});
export type FramesSaveResponse = z.infer<typeof framesSaveResponseSchema>;

// --- GET /api/v2/catalog: the server owns the domain definitions ---
// The editor form of a card kind (server-defined, see format/Catalog)
export const formKindSchema = z.enum(['request', 'swagger', 'mongo', 'query', 'script', 'condition', 'json', 'code']);
export type FormKind = z.infer<typeof formKindSchema>;

// One card kind of a type: subtype is null for types without subtypes
export const cardKindSchema = z.object({
  subtype: z.string().nullable(),
  cardType: cardTypeSchema,
  language: z.string(),
  form: formKindSchema,
  defaultWidth: z.number(),
  defaultHeight: z.number(),
  defaultTimeout: z.number()
});
export type CardKind = z.infer<typeof cardKindSchema>;

// A source type: hasSources = cards name a source (false for rawvalue, jsonassert)
export const catalogEntrySchema = z.object({
  name: z.string(),
  language: z.string(),
  hasSources: z.boolean(),
  subtypes: z.array(z.string()),
  cards: z.array(cardKindSchema)
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const catalogResponseSchema = z.object({
  sourceTypes: z.array(catalogEntrySchema),
  httpMethods: z.array(z.string())
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

// --- Other framework responses ---
export const healthResponseSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  servico: z.string().optional()
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// GET /api/v2/projects: folders with testframe/ under the projects dir, most recent first
export const projectSummarySchema = z.object({
  name: z.string(),
  frames: z.number(),
  sources: z.number(),
  lastModified: z.string() // ISO instant
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

// --- GET /api/v2/sources/openapi/{name}/operations: the cached operations of an openapi source ---
export const openApiOperationSchema = z.object({
  operationId: z.string(),
  method: z.string(),
  path: z.string(),
  summary: z.string()
});
export type OpenApiOperation = z.infer<typeof openApiOperationSchema>;

export const openApiSpecSchema = z.object({
  specUrl: z.string(),
  baseUrl: z.string(), // the API base requests go to
  fetchedAt: z.string(),
  operations: z.array(openApiOperationSchema)
});
export type OpenApiSpec = z.infer<typeof openApiSpecSchema>;

// POST /api/v2/validate: the server's code rule for a (type, subtype) (null = acceptable)
export const validateResponseSchema = z.object({
  problem: z.string().nullish()
});
export type ValidateResponse = z.infer<typeof validateResponseSchema>;

// --- Card run outcomes (POST /api/v2/run and /api/v2/run/card) ---
// One outcome per executed card; `code` is set when the run rewrote that card's body (the
// JSON result card that received a response), and `vars` carries every published variable.
export const cardRunOutcomeSchema = z.object({
  varName: z.string(),
  status: z.enum(['success', 'error', 'skipped']),
  text: z.string(),
  output: z.string(),
  at: z.string(),
  ranAt: z.string(),
  code: z.string().nullish()
});
export type CardRunOutcome = z.infer<typeof cardRunOutcomeSchema>;

export const frameRunResponseSchema = z.object({
  project: z.string(),
  frame: z.string(),
  results: z.array(cardRunOutcomeSchema),
  vars: z.record(z.string(), z.unknown())
});
export type FrameRunResponse = z.infer<typeof frameRunResponseSchema>;

export const cardRunResponseSchema = z.object({
  result: cardRunOutcomeSchema,
  vars: z.record(z.string(), z.unknown())
});
export type CardRunResponse = z.infer<typeof cardRunResponseSchema>;
