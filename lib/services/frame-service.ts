import * as Catalog from '../format/catalog';
import { ApiError, FormatError } from '../format/errors';
import * as FrameCodec from '../format/frame-codec';
import * as Names from '../format/names';
import type { Card, CardRun, Frame, FramesResponse } from '../format/types';
import type { OpenApiService } from '../openapi/openapi-service';
import { type OpenApiSpec, byId, endpointOf, hasEndpoint } from '../openapi/openapi-spec';
import * as Sources from '../sources/sources-yaml';
import { FRAMES_DIR, type ProjectStore, type SaveResult } from '../store/project-store';
import type { SourceService } from './source-service';

const RUNS_DIR = 'runs';
/** `.testframebuild/runs/{env}/{frame}/step-{n}/{var-file}.json` (layout private to the IDE). */
const runPath = (env: string, base: string) => `${RUNS_DIR}/${env}/${base}.json`;

const STATUSES = ['success', 'error', 'skipped'];

/**
 * Frames of a project (testframe/frames/). Each card comes with its private notes and its last
 * run in the requested environment; load problems and warnings (undeclared sources, openapi
 * operations missing from the environment's cached spec) are reported in `errors`.
 */
export class FrameService {
  constructor(
    private readonly store: ProjectStore,
    private readonly sources: SourceService,
    private readonly openApi: OpenApiService
  ) {}

  async load(project: string, env?: string | null): Promise<FramesResponse> {
    const { files, errors: fileErrors } = await this.store.list(project, FRAMES_DIR);
    const { errors: sourceErrors, ...model } = await this.sources.load(project);
    const environment = env && model.environments.includes(env) ? env : null;
    const results = environment ? await this.lastRuns(project, environment) : new Map<string, CardRun>();
    const read = FrameCodec.read(files, results);
    const errors = [...fileErrors, ...read.errors];
    const declared = new Set(Sources.declaredRefs(model));
    const resolved = environment && !sourceErrors.length ? Sources.resolve(model, environment) : null;
    const specs = new Map<string, OpenApiSpec | null>();
    for (const frame of read.frames) {
      for (const step of frame.steps ?? []) {
        for (const card of step.cards ?? []) {
          const where = `${frame.name}/step-${step.number}/${Names.varNameToFileName(card.varName)}`;
          const ref = `${card.sourceType}/${card.sourceName}`;
          if (Catalog.hasSources(card.sourceType) && card.sourceName && !declared.has(ref)) {
            errors.push(`${where}: source ${ref} is not declared in sources.yaml`);
            continue;
          }
          const source = resolved?.get(ref);
          if (card.sourceType !== 'openapi' || !source?.configured || Names.isBlank(card.endpoint)) continue;
          if (!specs.has(ref)) specs.set(ref, await this.openApi.cachedOf(project, source, environment!));
          const warning = endpointWarning(specs.get(ref) ?? null, card);
          if (warning) errors.push(`${where}: ${warning}`);
        }
      }
    }
    return { frames: read.frames, errors };
  }

  /** Last runs of one environment, by card base. */
  private async lastRuns(project: string, env: string): Promise<Map<string, CardRun>> {
    const out = new Map<string, CardRun>();
    for (const file of await this.store.listBuild(project, `${RUNS_DIR}/${env}`)) {
      if (!file.endsWith('.json')) continue;
      const run = parseRun(await this.store.readBuild(project, `${RUNS_DIR}/${env}/${file}`));
      if (run) out.set(file.slice(0, -'.json'.length), run);
    }
    return out;
  }

  /** Replaces frames/{slug(frame.name)}/ with the frame (other frames are untouched); drops the last runs of removed cards. */
  async save(project: string, frame: Frame | null | undefined): Promise<SaveResult> {
    if (!frame || typeof frame.name !== 'string') throw new FormatError('frame is required');
    const shape = frameShapeProblems(frame);
    if (shape.length) throw new FormatError(shape);
    const written = FrameCodec.write(frame);
    const result = await this.store.replace(project, FRAMES_DIR, [written.dir], [], written.files);
    const kept = new Set(written.files.filter((f) => f.path.endsWith('.md') && !f.path.endsWith('.private.md')).map((f) => f.path.slice(0, -3)));
    for (const env of await this.store.listBuildDirs(project, RUNS_DIR)) {
      for (const file of await this.store.listBuild(project, `${RUNS_DIR}/${env}/${written.dir}`)) {
        const base = `${written.dir}/${file.replace(/\.json$/, '')}`;
        if (!kept.has(base)) await this.store.deleteBuild(project, `${RUNS_DIR}/${env}/${base}.json`);
      }
    }
    return result;
  }

  /** Stores the last run of a card in one environment (.testframebuild/, gitignored). */
  async saveResult(
    project: string,
    environment: string | null | undefined,
    frame: string | null | undefined,
    step: number | null | undefined,
    varName: string | null | undefined,
    result: CardRun | null | undefined
  ): Promise<{ project: string; saved: number }> {
    if (!frame || !frame.trim() || !step || step < 1 || !Number.isInteger(step) || !varName || !varName.trim() || !result) {
      throw new FormatError('environment, frame, step (>= 1), varName and result are required');
    }
    const problem = Names.camelNameProblem('varName', varName);
    if (problem) throw new FormatError(problem);
    const { errors, ...model } = await this.sources.load(project);
    if (!environment || !model.environments.includes(environment)) {
      throw new ApiError(400, errors.length && !model.environments.length
        ? `the project's source files are invalid: ${errors.join('; ')}`
        : `unknown environment "${environment ?? ''}" (sources.yaml lists: ${model.environments.join(', ') || 'none'})`);
    }
    const run: CardRun = {
      status: STATUSES.includes(result.status) ? result.status : 'idle',
      text: String(result.text ?? '').replace(/\s+/g, ' '),
      output: String(result.output ?? ''),
      elapsedMs: typeof result.elapsedMs === 'number' ? result.elapsedMs : null,
      ranAt: result.ranAt ?? null
    };
    await this.store.writeBuild(project, runPath(environment, FrameCodec.cardBase(frame, step, varName)), `${JSON.stringify(run, null, 2)}\n`);
    return { project, saved: 1 };
  }

  /** Drops the cached runs and specs of environments that are no longer listed. */
  async dropEnvironments(project: string, keep: string[]): Promise<void> {
    for (const dir of [RUNS_DIR, 'openapi']) {
      for (const env of await this.store.listBuildDirs(project, dir)) {
        if (!keep.includes(env)) await this.store.deleteBuild(project, `${dir}/${env}`);
      }
    }
  }

  /** Cards (in every frame) bound to a source that sources.yaml does not declare. */
  async undeclaredSourceUses(project: string, model: Sources.SourcesModel): Promise<string[]> {
    const declared = new Set(Sources.declaredRefs(model));
    const { files } = await this.store.list(project, FRAMES_DIR);
    const read = FrameCodec.read(files);
    const out: string[] = [];
    for (const frame of read.frames) {
      for (const step of frame.steps ?? []) {
        for (const card of step.cards ?? []) {
          const ref = `${card.sourceType}/${card.sourceName}`;
          if (Catalog.hasSources(card.sourceType) && card.sourceName && !declared.has(ref)) {
            out.push(`${frame.name}/step-${step.number}/${card.varName}: source ${ref} is not declared in sources.yaml`);
          }
        }
      }
    }
    return out;
  }
}

function parseRun(content: string | null): CardRun | null {
  if (!content) return null;
  try {
    const v = JSON.parse(content) as CardRun;
    return { ...v, status: STATUSES.includes(v.status) ? v.status : 'idle' };
  } catch {
    return null;
  }
}

/** The card fields stored as text, and the ones stored as numbers (`Card`, minus the derived ones). */
const TEXT_FIELDS = ['varName', 'title', 'sourceType', 'sourceName', 'subtype', 'collection', 'endpoint', 'openapiId', 'code', 'privateData'] as const;
const NUMBER_FIELDS = ['timeout', 'width', 'height', 'resultHeight'] as const;

const isText = (v: unknown): boolean => v === null || v === undefined || typeof v === 'string';
const isNumber = (v: unknown): boolean => v === null || v === undefined || typeof v === 'number';
const isObject = (v: unknown): boolean => v !== null && typeof v === 'object';

/**
 * Type-checks a frame that came from a request body: the codec reads every field as the text or
 * number it is declared to be, so a card holding `code: 5` would be a TypeError (answered 500)
 * instead of a 400 naming the field.
 */
function frameShapeProblems(frame: Frame): string[] {
  if (frame.steps !== null && frame.steps !== undefined && !Array.isArray(frame.steps)) return ['steps must be a list of steps'];
  const problems: string[] = [];
  (frame.steps ?? []).forEach((step, s) => {
    const where = `step ${s + 1}`;
    if (!isObject(step)) {
      problems.push(`${where}: a step must be an object`);
      return;
    }
    if (step.cards !== null && step.cards !== undefined && !Array.isArray(step.cards)) {
      problems.push(`${where}: cards must be a list of cards`);
      return;
    }
    (step.cards ?? []).forEach((card, c) => {
      const which = `${where}, card ${c + 1}`;
      if (!isObject(card)) {
        problems.push(`${which}: a card must be an object`);
        return;
      }
      const fields = card as unknown as Record<string, unknown>;
      for (const field of TEXT_FIELDS) if (!isText(fields[field])) problems.push(`${which}: ${field} must be a string`);
      for (const field of NUMBER_FIELDS) if (!isNumber(fields[field])) problems.push(`${which}: ${field} must be a number`);
    });
  });
  return problems;
}

/** An openapi card whose operation is not in the source's cached spec (null when fine or unknown). */
export function endpointWarning(spec: OpenApiSpec | null, card: Card): string | null {
  if (!spec) return null;
  const endpoint = Names.trim(card.endpoint);
  if (Names.isBlank(card.openapiId)) {
    return hasEndpoint(spec, endpoint) ? null : `endpoint "${endpoint}" is not an operation of the openapi/${card.sourceName} spec`;
  }
  // the operationId is the identity: the endpoint must still be its method + path
  const op = byId(spec, card.openapiId);
  if (!op) return `openapi-id "${card.openapiId}" is not an operation of the openapi/${card.sourceName} spec`;
  return endpointOf(op).toLowerCase() === endpoint.replace(/\s+/g, ' ').toLowerCase()
    ? null
    : `endpoint "${endpoint}" no longer matches operation ${card.openapiId} (${endpointOf(op)}) of the openapi/${card.sourceName} spec`;
}
