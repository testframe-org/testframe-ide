import { handle, readJson } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import { saveSources } from '@/lib/services/sources-save';

/** `{project, environments, layers, env?}`: rewrites the sources*.yaml layers (400 with every problem). */
export async function POST(request: Request) {
  return handle(async () => saveSources(services(), await readJson(request)));
}
