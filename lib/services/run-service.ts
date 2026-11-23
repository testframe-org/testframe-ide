import * as Catalog from '../format/catalog';
import { ApiError } from '../format/errors';
import * as Names from '../format/names';
import type { Card } from '../format/types';
import type { OpenApiService } from '../openapi/openapi-service';
import type { ResolvedSource } from '../sources/sources-yaml';
import type { RunnerClient } from './runner-client';
import type { SourceService } from './source-service';

// Runs from the editor (POST /api/v2/run, /run/card, /run/mongo): the IDE builds the
// self-contained request of agents/specs/runner-protocol.md (cards as the editor has them, the sources
// they use resolved in the run's environment with the openapi operations from the environment's
// cache, and the secrets) and forwards it to the runner plugin; the plugin's answer (JSON, or the
// NDJSON stream with `Accept: application/x-ndjson`) goes back as is.

const MAX_RUN_MS = 600_000;
export const NDJSON = 'application/x-ndjson';

/** A card of the runner protocol (derived and layout fields are not part of it). */
export interface ProtocolCard {
  varName: string;
  title: string | null;
  sourceType: string;
  sourceName: string | null;
  subtype: string | null;
  collection: string | null;
  endpoint: string | null;
  openapiId: string | null;
  timeout: number | null;
  code: string;
}

export type ProtocolSources = Record<string, Record<string, unknown>>;

const orNull = (s: string | null | undefined) => (s && s.trim() ? s : null);

export function toProtocolCard(card: Card): ProtocolCard {
  return {
    varName: card.varName || Names.toVarName(card.title),
    title: orNull(card.title),
    sourceType: card.sourceType ?? '',
    sourceName: Catalog.hasSources(card.sourceType) ? orNull(card.sourceName) : null,
    subtype: orNull(card.subtype),
    collection: orNull(card.collection),
    endpoint: orNull(card.endpoint),
    openapiId: orNull(card.openapiId),
    timeout: typeof card.timeout === 'number' ? card.timeout : null,
    code: card.code ?? ''
  };
}

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export class RunService {
  constructor(
    private readonly sources: SourceService,
    private readonly openApi: OpenApiService,
    private readonly runner: RunnerClient
  ) {}

  /**
   * `sources` and `secrets` for the cards: every named source they reference that is configured
   * in `env` (a missing one stays out: the plugin reports it as that card's error).
   */
  async resolveFor(project: string, env: string, cards: ProtocolCard[]): Promise<{ sources: ProtocolSources; secrets: string[] }> {
    const resolved = await this.sources.resolve(project, env);
    const refs = [...new Set(cards.filter((c) => c.sourceName && Catalog.hasSources(c.sourceType)).map((c) => `${c.sourceType}/${c.sourceName}`))];
    const sources: ProtocolSources = {};
    const secrets = new Set<string>();
    for (const ref of refs) {
      const source = resolved.get(ref);
      if (!source?.configured) continue;
      sources[ref] = await this.entryOf(project, env, source);
      source.secrets.forEach((s) => secrets.add(s));
    }
    return { sources, secrets: [...secrets] };
  }

  private async entryOf(project: string, env: string, source: ResolvedSource): Promise<Record<string, unknown>> {
    switch (source.type) {
      case 'openapi': {
        let spec;
        try {
          spec = await this.openApi.specOf(project, source, env);
        } catch (e) {
          if (e instanceof ApiError) throw new ApiError(e.status, `openapi/${source.name}: ${e.message}`);
          throw e;
        }
        return {
          apiBase: spec.baseUrl,
          headers: source.headers,
          operations: spec.operations.map(({ operationId, method, path }) => ({ operationId, method, path }))
        };
      }
      case 'mongo':
        return { uri: source.baseUrl };
      default:
        return { url: source.baseUrl };
    }
  }

  /** POST /api/v2/run `{project, frame, environment, steps: [{number, cards}], deadlineMs?}`. */
  async runFrame(body: unknown, accept: string): Promise<Response> {
    if (!isMap(body)) throw new ApiError(400, 'expected a JSON object');
    const project = requireString(body, 'project');
    const frame = requireString(body, 'frame');
    const environment = requireString(body, 'environment');
    if (!Array.isArray(body.steps)) throw new ApiError(400, 'steps is required');
    await this.runner.requireUp();
    const steps = body.steps.map((s: unknown, i: number) => {
      const step = isMap(s) ? s : {};
      const cards = Array.isArray(step.cards) ? (step.cards as Card[]) : [];
      return { number: typeof step.number === 'number' ? step.number : i + 1, cards: cards.map(toProtocolCard) };
    });
    const { sources, secrets } = await this.resolveFor(project, environment, steps.flatMap((s) => s.cards));
    const deadlineMs = typeof body.deadlineMs === 'number' ? Math.min(Math.max(body.deadlineMs, 1000), MAX_RUN_MS) : MAX_RUN_MS;
    return this.runner.post('/api/v1/run', { frame, environment, steps, sources, secrets, deadlineMs }, accept, deadlineMs + 10_000);
  }

  /** POST /api/v2/run/card `{project, environment, step, card, vars, payload, resultCard}`. */
  async runCard(body: unknown): Promise<Response> {
    if (!isMap(body)) throw new ApiError(400, 'expected a JSON object');
    const project = requireString(body, 'project');
    const environment = requireString(body, 'environment');
    if (!isMap(body.card)) throw new ApiError(400, 'card is required');
    await this.runner.requireUp();
    const card = toProtocolCard(body.card as Card);
    const { sources, secrets } = await this.resolveFor(project, environment, [card]);
    const request = {
      environment,
      step: typeof body.step === 'number' ? body.step : 1,
      card,
      vars: isMap(body.vars) ? body.vars : {},
      payload: typeof body.payload === 'string' ? body.payload : null,
      resultCard: isMap(body.resultCard) ? body.resultCard : null,
      sources,
      secrets
    };
    const timeout = Math.min(Math.max(card.timeout ?? 5000, 100), 120_000);
    return this.runner.post('/api/v1/run/card', request, 'application/json', timeout + 10_000);
  }

  /**
   * POST /api/v2/run/mongo `{project, environment, source, subtype, collection, body, timeoutMs?}`:
   * one mongo call (body = the JSON array of arguments), run as a single card.
   */
  async runMongo(body: unknown): Promise<Response> {
    if (!isMap(body)) throw new ApiError(400, 'expected a JSON object');
    const card: Card = {
      varName: 'mongoCall',
      title: 'Mongo call',
      sourceType: 'mongo',
      sourceName: requireString(body, 'source'),
      subtype: requireString(body, 'subtype'),
      collection: requireString(body, 'collection'),
      timeout: typeof body.timeoutMs === 'number' ? body.timeoutMs : null,
      code: requireMongoBody(body.body)
    };
    return this.runCard({ project: body.project, environment: body.environment, step: 1, card, vars: {} });
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) throw new ApiError(400, `${key} is required`);
  return v;
}

/**
 * The mongo call's `body`: the JSON array of the driver function's arguments, sent as text (the
 * card code). Anything else is a 400 — silently running an empty body would answer with the
 * plugin's "no arguments" error for a request that named its arguments in the wrong shape.
 */
function requireMongoBody(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'body is required (the JSON array of the call arguments, as a string)');
  }
  return value;
}
