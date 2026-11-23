# AGENTS.md — testframe-ide (authoring)

Next.js (App Router) + React 19 + TypeScript + Tailwind v4 + Radix + zod, managed with **bun**.
The **authoring** side of testframe: it owns the project format and everything that edits it.
All code, comments and docs in English; UI copy goes through i18n (en / pt-BR).

## Golden rules

- **This module owns the project format** (`lib/format`, spec `agents/specs/project-format.md`). The
  execution plugin (`modules/testframe-plugin-spring`) holds read-only Java decoders of the same
  format; `bun run format:check` at the repo root is the parity gate. A format change lands here
  first, then in the plugin's decoders, then in the example projects — in the same pass.
- **It does not execute cards.** A run is a self-contained request built here (resolved sources,
  openapi operations, secrets) and sent to the plugin at `TESTFRAME_RUNNER_URL`. Editing must keep
  working with the plugin down: only run routes answer 503.
- **No client touches the project files.** The editor talks to this module's route handlers, which
  exchange JSON. Never read or write a `.md`/`.yaml` project file from a component or a script.
- The catalog is data, not code: source types, subtypes, card forms, languages and defaults come
  from `lib/format/catalog` and are served by `GET /api/v2/catalog`. Never hardcode a copy of that
  table in the editor.

## Layout

| Path | What it is |
|---|---|
| `app/` | App Router: the editor page(s) plus the `/api/v2/*` and `/api/tour/*` route handlers |
| `lib/format/` | **The format**: `md-envelope`, `names`, `card-codec`, `frame-codec`, `catalog`, `code-rules`, `jsonassert-code`, `mongo-call`, `mongo-json`, `strict-json`, `types`, `errors` |
| `lib/store/project-store.ts` | All disk access: atomic writes, **path sanitization**, `replace(...)` pruning, the `sources*.yaml` layers, `.testframebuild/`, `testframe/.gitignore` |
| `lib/sources/` | `sources-yaml` (the layered sources: read, merge, validate, canonical write), `sources-yaml.z` (its shapes as zod schemas — import the types from here, they are not re-exported), plus `private-marker` and `source-rename`, the two pieces the editor imports without the YAML parser |
| `lib/services/` | `context` (process-wide services), `frame-service`, `source-service`, `sources-save`, `openapi` consumers, `runner-client`, `run-service` |
| `lib/openapi/` | `openapi-spec` (a spec distilled to its API base + operations) and `openapi-service` (the `.testframebuild/` operations cache, per environment) |
| `lib/api/` | `http` (`handle(request, fn)` with the request guard, `readJson`), `tour-proxy` (the validated `/api/tour/*` target), `domain` |
| `editor/` | The editor UI as client components (canvas, cards, inspector, sources, environment selector) |
| `tests/` | `bun test` suites: `tests/format/*`, `tests/store/*`, `tests/sources/*`, `tests/services/*`, `tests/api/*`, `tests/scripts/*`, `tests/helpers/*` |
| `scripts/` | Parameter-driven runners — every setting arrives as `--key=value`, this module never reads the root config |
| `examples/<project>/testframe/` | Example projects in the current format |
| `agents/specs/project-format.md` | The format spec (canonical) |

`tsconfig.json` includes `app`, `lib`, `editor`, `tests`, `scripts` and excludes `examples`.
`next.config.ts` sets the bundler root to the monorepo root so
`@jsonassert/jsonassert-js` resolves to the engine's TypeScript **sources** (tsconfig `paths`) —
that is what makes the live assertion preview work without a build step.

## API

`/api/v2/*` — authoring, all of it backed by `lib/`:

| Route | Purpose |
|---|---|
| `GET /api/v2/health` | IDE status, plus `runner` telling whether runs can go through the plugin |
| `GET /api/v2/projects` | Projects under `TESTFRAME_PROJECTS_ROOT`, most recent first |
| `GET /api/v2/frames/[project]` | A project's frames (with load `errors`) |
| `POST /api/v2/frames` | Validate and replace a frame's files |
| `GET /api/v2/sources/[project]` | The project's layers, every `.private.yaml` value replaced by the marker `"<private>"` (`SourceService.view`) |
| `POST /api/v2/sources` | Validate and rewrite the `sources*.yaml` layers; a `"<private>"` field keeps the value on disk, and `renames` carries the stored private values of a renamed source |
| `GET /api/v2/sources/openapi/[name]/operations` (+ `/refresh`) | The source's cached operations for an environment (`{baseUrl, fetchedAt, operations}`, never the spec URL) |
| `GET /api/v2/catalog` | Source types, subtypes, card forms, languages, defaults, HTTP methods |
| `POST /api/v2/validate` | The code rule of a (type, subtype) |
| `POST /api/v2/results` | Store a card's last run in `.testframebuild/`, per environment |
| `POST /api/v2/run`, `/run/card`, `/run/mongo` | Build the self-contained request and call the plugin, streaming NDJSON through |
| `/api/tour/*` | Proxy to the plugin's tour API (the IDE saves before opening the tour) |

Rejected saves are a 400 `{status, message}`; load problems come back in `errors` and surface in the
UI — never as a silent crash.

## Configuration

Nothing is hardcoded. The module scripts pass the settings as environment variables:

| Variable | Meaning |
|---|---|
| `TESTFRAME_PROJECTS_ROOT` | Directory holding the projects (`{root}/{project}/testframe/`) |
| `TESTFRAME_RUNNER_URL` | Base URL of the execution plugin (runs and tour) |
| `TESTFRAME_RUNNER_TOKEN` | Optional bearer token of the plugin |

Port and the two URLs are resolved by the repo-root `scripts/` from `package.json > config`
(`idePort`, `runnerPort`) and forwarded here as parameters.

## Conventions

- Strict TypeScript: no implicit `any`, component props typed via interfaces, `bun run typecheck`
  must pass clean.
- Secrets live only in `sources*.private.yaml` layers (gitignored) and are sent to the plugin as
  `secrets` so it can redact them. They never come back and never reach the browser: routes
  return `SourceService.view` (private values masked as `PRIVATE_MARKER`, `"<private>"`), never
  `load`; a save resolves each marker against the value on disk (`unmaskModel`, applied to the
  stored model renamed by the save's `renames` so a renamed source keeps its values); the editor
  shows private fields write-only. The openapi cache is keyed by the spec URL's SHA-256 and the spec URL
  is never returned; error messages and warnings go through `redact` with the source's secrets;
  the runner health strips user-info from the plugin URL.
- Generated files go to `testframe/.testframebuild/` (internal layout, safe to delete, gitignored):
  the openapi operations cache and the cards' last runs, both per environment. `ProjectStore` writes
  `testframe/.gitignore` with `*.private.md`, `*.private.yaml` and `.testframebuild/`.
- Every run needs an environment. The editor has a current-environment selector; the last run of a
  card is kept per environment.
- A mongo card body is one JSON array of the driver function's positional arguments; the editor
  shows the subtype's argument signature as a hint.
- Keep the Figma look of the canvas (ring per status, floating console).

## Security

Every route handler goes through `handle(request, fn)` (`lib/api/http.ts`): the IDE binds to
`127.0.0.1` (`scripts/dev.ts`), answers only loopback `Host` names (DNS rebinding), refuses
state-changing requests whose `Sec-Fetch-Site`/`Origin` is not its own (CSRF), and `readJson`
accepts only `application/json` (415). The tour proxy builds its target with
`lib/api/tour-proxy.ts` (segment whitelist, no `.`/`..`), so it never leaves `/api/v1/tour`.
Files over 2 MiB are never written (400 before any write of the save).

`lib/store/project-store.ts` is the security boundary: character whitelist, `..` rejected, the
resolved path must stay under its base, `.md` only where the format says so, no symlink following
(checked when a path is resolved and again immediately before each write), and `replace(...)`
prunes stale files inside a scope that can never be the `frames/` root. Keep
those rules in every new route that accepts a name or a path, and add a test that would fail if the
guard were removed. Use the `guardian` thread for changes here.

## Commands

```bash
bun install
bun test            # format + store suites
bun run typecheck   # tsc --noEmit — must pass clean
bun run build       # next build
bun run dev         # only with the settings from the root runner
```

From the repo root: `bun run dev <project>` (plugin + IDE), `bun run example:push` (regenerate the
example projects through the API), `bun run smoke`, `bun run format:check`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
