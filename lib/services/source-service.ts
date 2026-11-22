import { ApiError } from '../format/errors';
import * as Names from '../format/names';
import * as Sources from '../sources/sources-yaml';
import type { ResolvedSource, SourcesModel } from '../sources/sources-yaml';
import type { ProjectStore, SaveResult } from '../store/project-store';

/** GET /api/v2/sources/{project}. */
export interface SourcesResponse extends SourcesModel {
  errors: string[];
}

/** The project's sources (the sources*.yaml layers at the testframe/ root). */
export class SourceService {
  constructor(private readonly store: ProjectStore) {}

  async load(project: string): Promise<SourcesResponse> {
    const { model, errors } = Sources.readModel(await this.store.readSourceLayers(project));
    return { ...model, errors };
  }

  /**
   * Validates and rewrites the layer files: sources.yaml, sources.private.yaml and the
   * sources.{env}[.private].yaml of every listed environment; empty layers and every layer of
   * an environment no longer listed are deleted. Invalid data is a 400 with every problem.
   */
  async save(project: string, input: unknown): Promise<{ result: SaveResult; model: SourcesModel; previous: SourcesModel }> {
    const { model, errors } = Sources.validateModel(input);
    if (errors.length) throw new ApiError(400, errors.join('; '), errors);
    const existing = await this.store.readSourceLayers(project);
    const previous = Sources.readModel(existing).model;
    const files = Sources.renderModel(model);
    const remove = [...existing.keys()].filter((name) => !files.has(name) && Sources.classify(name) !== null);
    const result = await this.store.writeSourceLayers(project, files, remove);
    return { result, model, previous };
  }

  /** The valid model, or a 400 listing why the sources cannot be used. */
  async validModel(project: string): Promise<SourcesModel> {
    const { errors, ...model } = await this.load(project);
    if (errors.length) throw new ApiError(400, `the project's source files are invalid: ${errors.join('; ')}`, errors);
    return model;
  }

  /** Checks `env` against the environments list (400 otherwise). */
  static checkEnvironment(model: SourcesModel, env: string | null | undefined): string {
    if (!env || !env.trim()) {
      throw new ApiError(400, model.environments.length
        ? `environment is required (${model.environments.join(', ')})`
        : 'environment is required, and sources.yaml declares no environments yet');
    }
    if (!model.environments.includes(env)) {
      throw new ApiError(400, `unknown environment "${env}" (sources.yaml lists: ${model.environments.join(', ') || 'none'})`);
    }
    return env;
  }

  /** Every declared source resolved for `env` (400 when the files are invalid or env is unknown). */
  async resolve(project: string, env: string | null | undefined): Promise<Map<string, ResolvedSource>> {
    const model = await this.validModel(project);
    return Sources.resolve(model, SourceService.checkEnvironment(model, env));
  }

  /** One source resolved for `env`: 404 when not declared, 400 when not configured there. */
  async resolveOne(project: string, type: string, name: string, env: string | null | undefined): Promise<ResolvedSource> {
    const problem = Names.sourceNameProblem(name);
    if (problem) throw new ApiError(400, `invalid source name "${name}": ${problem}`);
    const source = (await this.resolve(project, env)).get(`${type}/${name}`);
    if (!source) throw new ApiError(404, `source ${type}/${name} is not declared in sources.yaml`);
    if (!source.configured) throw new ApiError(400, `source ${type}/${name} has no base-url in environment ${env}`);
    return source;
  }
}
