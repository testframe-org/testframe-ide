import { type Fetcher, OpenApiService } from '../openapi/openapi-service';
import { ApiError } from '../format/errors';
import * as Sources from '../sources/sources-yaml';
import { ProjectStore } from '../store/project-store';
import { FrameService } from './frame-service';
import { RunService } from './run-service';
import { RunnerClient } from './runner-client';
import { SourceService } from './source-service';

// The IDE's services, built once per server process from its configuration (passed by the
// module scripts as environment variables; nothing is hardcoded):
//   TESTFRAME_PROJECTS_ROOT  directory holding the projects ({root}/{project}/testframe/)
//   TESTFRAME_RUNNER_URL     base URL of the runner plugin (runs and the tour)
//   TESTFRAME_RUNNER_TOKEN   optional bearer token of the plugin

export interface Services {
  store: ProjectStore;
  sources: SourceService;
  openApi: OpenApiService;
  frames: FrameService;
  runner: RunnerClient;
  runs: RunService;
}

export function createServices(projectsRoot: string, runnerUrl?: string, runnerToken?: string, fetcher?: Fetcher): Services {
  const store = new ProjectStore(projectsRoot);
  const sources = new SourceService(store);
  const openApi = new OpenApiService(store, sources, fetcher);
  const frames = new FrameService(store, sources, openApi);
  const runner = new RunnerClient(runnerUrl || undefined, runnerToken || undefined);
  const runs = new RunService(sources, openApi, runner);
  return { store, sources, openApi, frames, runner, runs };
}

const globalKey = Symbol.for('testframe.services');
type WithServices = typeof globalThis & { [globalKey]?: Services };

/** The process-wide services (kept on globalThis so dev reloads reuse them). */
export function services(): Services {
  const g = globalThis as WithServices;
  if (!g[globalKey]) {
    const root = process.env.TESTFRAME_PROJECTS_ROOT;
    if (!root) throw new ApiError(500, 'TESTFRAME_PROJECTS_ROOT is not set (the module scripts pass it to the IDE)');
    g[globalKey] = createServices(root, process.env.TESTFRAME_RUNNER_URL, process.env.TESTFRAME_RUNNER_TOKEN);
  }
  return g[globalKey]!;
}

/** Number of sources declared by a project (0 when its files are missing or invalid). */
export async function countSources(s: Services, project: string): Promise<number> {
  try {
    return Sources.declaredRefs(await s.sources.load(project)).length;
  } catch {
    return 0;
  }
}
