import { z } from 'zod';

// ============================================================================
// THE ONE zod file of the client: every shape (editor model, frames/sources
// wire shapes, framework API responses) is defined here as a schema, and the
// types are inferred from it; the endpoint helpers in testframe.ts parse every
// response against these schemas, so nothing crosses the wire unchecked.
// ============================================================================

// --- Editor model ---

// Derived from the source type (cardTypeOf), never stored: each family has its own type
export const cardTypeSchema = z.enum(['request', 'js', 'sql', 'jsonassert', 'json', 'validation']);
export type CardType = z.infer<typeof cardTypeSchema>;

export const cardStatusSchema = z.enum(['idle', 'running', 'success', 'error']);
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
  code: z.string(),
  sourceType: z.string(),
  sourceName: z.string(),
  script: z.string().optional(), // camelCase name of a script of the card's source; empty body on disk = inherit it
  resultHeight: z.number().optional(), // px of the last-run panel under the script (absent = default)
  privateData: z.string().optional(), // body of {var-file}.private.md (gitignored; falls back to .private.example.md)
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
export const sourceScriptSchema = z.object({
  name: z.string(), // camelCase, e.g. getActiveProducts -> scripts/get-active-products.md
  body: z.string() // the query/code itself
});
export type SourceScript = z.infer<typeof sourceScriptSchema>;

export const sourceDefSchema = z.object({
  typeSource: z.string(),
  name: z.string(),
  baseUrl: z.string().optional(),
  publicData: z.string(),
  privateData: z.string(),
  scripts: z.array(sourceScriptSchema).optional() // custom queries; swagger sources rely on the spec instead
});
export type SourceDef = z.infer<typeof sourceDefSchema>;

export const sourcesLoadResponseSchema = z.object({
  sources: z.array(sourceDefSchema)
});
export type SourcesLoadResponse = z.infer<typeof sourcesLoadResponseSchema>;

// --- Wire shapes of GET/POST /api/v2/frames (the server owns the .md format) ---
// type and httpMethod are derived by the server (ignored on save), as are step numbers
// (positions); the card sequence in a step comes from its flow.md. lastRun is the card's
// {var-file}.result-data.md.
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
  sourceName: z.string(),
  script: z.string().nullish(),
  endpoint: z.string(),
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
  saved: z.number()
});
export type FramesSaveResponse = z.infer<typeof framesSaveResponseSchema>;

// --- GET /api/v2/catalog: the server owns the domain definitions ---
export const catalogEntrySchema = z.object({
  name: z.string(),
  cardType: cardTypeSchema,
  language: z.string(),
  hasScripts: z.boolean(),
  defaultWidth: z.number(),
  defaultHeight: z.number(),
  defaultTimeout: z.number()
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const catalogResponseSchema = z.object({
  sourceTypes: z.array(catalogEntrySchema),
  httpMethods: z.array(z.string()),
  mongoOps: z.array(z.string())
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

// POST /api/v2/validate: the server's code rule for a source type (null = acceptable)
export const validateResponseSchema = z.object({
  problem: z.string().nullish()
});
export type ValidateResponse = z.infer<typeof validateResponseSchema>;

// --- Card run outcomes (POST /api/v2/run and /api/v2/run/card) ---
// One outcome per executed card; `code` is set when the run rewrote that card's body (the
// JSON result card that received a response), and `vars` carries every published variable.
export const cardRunOutcomeSchema = z.object({
  varName: z.string(),
  status: z.enum(['success', 'error']),
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
