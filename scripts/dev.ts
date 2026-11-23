// Starts the IDE (Next.js). Module responsibility: every setting arrives as a parameter, this
// script never reads the root package.json (the repo-root scripts/ resolve it and forward it).
//
// Usage: bun scripts/dev.ts --port=15173 --projectsRoot=<abs dir> --runnerUrl=http://localhost:18080
//                           [--runnerToken=<token>] [--project=<name>]
//
// The values become the IDE's configuration (TESTFRAME_PROJECTS_ROOT, TESTFRAME_RUNNER_URL,
// TESTFRAME_RUNNER_TOKEN); --project only shapes the URL printed here.
import { resolve } from 'node:path';
import { parseFlags } from './args';

/** The IDE listens on the loopback interface only: it edits files and holds the plugin token. */
export const HOST = '127.0.0.1';

/** The `next dev` arguments: always bound to {@link HOST}, never to every interface. */
export const nextDevArgs = (port: number): string[] => ['dev', '--hostname', HOST, '--port', String(port)];

if (import.meta.main) await main();

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const port = flags.requireNumber('port');
  const projectsRoot = flags.require('projectsRoot');
  const runnerUrl = flags.optional('runnerUrl');
  const runnerToken = flags.optional('runnerToken');
  const project = flags.optional('project');

  const moduleRoot = resolve(import.meta.dir, '..');
  // The local Next CLI: its shebang runs it under node, exactly like `bun run dev` does.
  const nextCli = resolve(moduleRoot, 'node_modules/.bin/next');

  const proc = Bun.spawn([nextCli, ...nextDevArgs(port)], {
    cwd: moduleRoot,
    env: {
      ...process.env,
      TESTFRAME_PROJECTS_ROOT: projectsRoot,
      ...(runnerUrl ? { TESTFRAME_RUNNER_URL: runnerUrl } : {}),
      ...(runnerToken ? { TESTFRAME_RUNNER_TOKEN: runnerToken } : {})
    },
    stdout: 'inherit',
    stderr: 'inherit'
  });

  console.log(`ide      : http://${HOST}:${port}${project ? `/?project=${encodeURIComponent(project)}` : ''}`);
  console.log(`projects : ${projectsRoot}`);
  console.log(`runner   : ${runnerUrl ?? '(not configured: editing works, runs are unavailable)'}\n`);

  let stopping = false;

  /** Stops Next (and its workers), escalating to SIGKILL when it ignores SIGTERM. */
  async function stop(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    proc.kill('SIGTERM');
    const escalate = setTimeout(() => proc.kill('SIGKILL'), 5000);
    await proc.exited;
    clearTimeout(escalate);
    process.exit(code);
  }

  process.on('SIGINT', () => void stop(0));
  process.on('SIGTERM', () => void stop(0));

  const exitCode = await proc.exited;
  if (!stopping) process.exit(exitCode);
}
