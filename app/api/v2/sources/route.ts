import { handle, readJson } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import { saveSources } from '@/lib/services/sources-save';

/**
 * `{project, environments, layers, renames?, env?}`: rewrites the sources*.yaml layers (400 with
 * every problem). `renames` are the sources renamed since the model was read, so their stored
 * private values follow the new name; `env` is the environment whose operations get refreshed.
 */
export async function POST(request: Request) {
  return handle(request, async () => saveSources(services(), await readJson(request)));
}
