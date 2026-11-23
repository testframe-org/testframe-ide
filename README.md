# testframe-ide

The **authoring** side of TestFrame: a Next.js app that owns the project format and everything
that edits it. You open a project, draw its frames on a Figma-style canvas (steps, and cards
inside each step), declare the sources those cards talk to, pick an environment and run — the run
itself is executed by the Spring plugin at `TESTFRAME_RUNNER_URL`, never here.

It writes and reads projects as plain files (`frames/**/*.md`, layered `sources*.yaml`), so a test
suite stays reviewable in git. The plugin is read-only and the tour UI is stateless: this module is
the only one that persists anything.

## Running it

From the repo root (resolves the ports from `package.json > config` and starts the plugin too):

```bash
bun run dev product-test
```

Directly, with every setting passed as a parameter (this module never reads the root config):

```bash
bun scripts/dev.ts \
  --port=15173 \
  --projectsRoot=$PWD/examples \
  --runnerUrl=http://localhost:18080 \
  --project=product-test
```

Then open `http://localhost:15173/?project=product-test`. Without `?project=` the IDE lists every
project under the projects root.

Editing works with the plugin down — only the run buttons report that it is unreachable.

### Configuration

| Variable | Meaning |
|---|---|
| `TESTFRAME_PROJECTS_ROOT` | Directory holding the projects, each as `{root}/{project}/testframe/` |
| `TESTFRAME_RUNNER_URL` | Base URL of the execution plugin (runs and the tour); optional |
| `TESTFRAME_RUNNER_TOKEN` | Bearer token of the plugin, when it is configured with one |

## What you can do in it

- **Frames tab** — the canvas: add steps, add cards, drag to resize, pan and zoom, edit a card's
  body in place (double-click) or in the card editor. Run the whole frame or a single card and
  watch each card's ring change colour as the streamed results arrive. Saving replaces the frame's
  directory, so removed cards do not linger on disk.
- **Environment selector** — every run needs an environment, and each card keeps its last run per
  environment (in the gitignored `testframe/.testframebuild/`).
- **Sources tab** — the layered `sources.yaml`: declare sources by type, then edit either the
  shared layers ("all environments" → `sources.yaml` + `sources.private.yaml`) or one
  environment's layers (`sources.{env}.yaml` + `sources.{env}.private.yaml`). `openapi` sources
  also get a headers editor. Values in a `.private.yaml` layer are secrets: they are sent to the
  plugin for redaction and are hidden in the canvas.
- **Cards** — the body of a card follows its (type, subtype): OpenAPI operations picked from the
  source's spec, a mongo call as one JSON array of positional arguments (with the signature as a
  hint), SQL, jsonassert scripts and conditionals, or a literal JSON value.

## The API

The editor talks to its own route handlers and nothing else — no client ever touches a project
file. All of it is JSON under `/api/v2/*` (frames, sources, catalog, validate, results, run) plus
`/api/tour/*`, which proxies to the plugin. `AGENTS.md` lists every route.

## Layout

| Path | What it is |
|---|---|
| `app/` | App Router: the editor page and the `/api/v2/*`, `/api/tour/*` route handlers |
| `editor/` | The editor UI (client components): canvas, cards, sources, environment selector, i18n |
| `lib/` | The format, the store, the services — the server side of the API |
| `scripts/` | Parameter-driven runners (`dev`) |
| `examples/` | Example projects, each a self-contained suite |
| `agents/specs/project-format.md` | The project format (canonical spec) |
| `tests/` | `bun test` suites for the format, the store and the services |

## Commands

```bash
bun install
bun test            # format, store and service suites
bun run typecheck   # tsc --noEmit
bun run build       # next build
```

## Reading on

- [`AGENTS.md`](AGENTS.md) — the rules: who owns what, the API table, conventions, security.
- [`agents/specs/project-format.md`](../../agents/specs/project-format.md) — the canonical format spec.
- [`../../agents/specs/architecture-split-plan.md`](../../agents/specs/architecture-split-plan.md) — how the IDE,
  the execution plugin and the tour UI split the work.
- [`../../agents/specs/runner-protocol.md`](../../agents/specs/runner-protocol.md) — what a run request and its
  results look like.
- [`examples/product-test/README.md`](examples/product-test/README.md) — the example suite.
