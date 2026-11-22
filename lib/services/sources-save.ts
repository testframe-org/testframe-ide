import { ApiError } from '../format/errors';
import * as Sources from '../sources/sources-yaml';
import type { SaveResult } from '../store/project-store';
import type { Services } from './context';

/** POST /api/v2/sources answer: the store result plus non-fatal warnings. */
export interface SourcesSaveResponse extends SaveResult {
  warnings: string[];
}

/**
 * Saves the sources of a project (body `{project, environments, layers, env?}`): rewrites the
 * layer files, drops the build caches of removed sources and environments, refreshes the openapi
 * operations of the current environment (`env`, default the first one; a spec that cannot be
 * read is a warning) and warns about cards bound to sources that are no longer declared.
 */
export async function saveSources(s: Services, body: unknown): Promise<SourcesSaveResponse> {
  const input = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const project = typeof input.project === 'string' ? input.project : '';
  if (!project.trim()) throw new ApiError(400, 'project is required');
  const { result, model, previous } = await s.sources.save(project, input);

  // removed sources and environments take their cached operations (and runs) with them
  const kept = new Set(Object.keys(model.layers.base.openapi ?? {}));
  for (const env of model.environments) {
    for (const name of Object.keys(previous.layers.base.openapi ?? {})) {
      if (!kept.has(name)) await s.store.deleteBuild(project, `openapi/${env}/${name}.json`);
    }
  }
  await s.frames.dropEnvironments(project, model.environments);

  const warnings: string[] = [];
  const env = typeof input.env === 'string' && model.environments.includes(input.env) ? input.env : model.environments[0];
  if (env) {
    for (const source of Sources.resolve(model, env).values()) {
      if (source.type !== 'openapi' || !source.configured) continue;
      try {
        await s.openApi.refreshOf(project, source, env);
      } catch (e) {
        warnings.push(`openapi/${source.name} (${env}): ${(e as Error).message}`);
      }
    }
  }
  warnings.push(...(await s.frames.undeclaredSourceUses(project, model)));
  return { ...result, warnings };
}
