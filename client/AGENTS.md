# AGENTS.md — testframe-ide client (editor)

Vite 8 + React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite`) + `lucide-react` + `zod` v4. Managed with **bun**. All code, comments and docs in English; UI copy goes through i18n (en / pt-BR).

## Structure

- `src/App.tsx` — main canvas (pan/zoom, steps, cards, flow execution, save/load frames)
- `src/i18n.tsx` — `I18nProvider` + `useI18n()`: every user-visible string lives in the
  `en` dictionary (authoritative); the `pt` dictionary is typed `Record<TKey, string>` so
  a missing translation fails the typecheck. Language persists to localStorage; toggle in the header.
- `src/client-api/` — network layer: `http.ts` (`requestJson` + `ApiError`), `testframe.ts`
  (every framework endpoint, including the runner `POST /api/v2/run` and `/api/v2/run/card`).
  No other `fetch` calls exist: the editor never executes flow requests itself.
- `src/components/` — `StepFrame`, `TestBlockCard`, `ConnectorArrow`, `AddBlockCircleButton`,
  `CardEditModal` (opened by a card's Edit button: general fields on the left, `SourceForm` on the right),
  `SourceForm` (one form per type-source: http, swagger, query, assert, json, expression, code),
  `ExecutionConsole`, `SourcesView` (the Sources tab: source CRUD incl. the scripts editor)
  , `CodeEditor` (the code textarea of `SourceForm` with a completion popup)
- `src/autocomplete.ts` — completion logic (pure): `{{varName.path}}` bindings in every body;
  in assert/expression bodies also jsonassert built-ins (`$sum(`), keywords, var-names and the
  fields of their last-run values. Ctrl+Space opens it, ↑/↓ + Enter/Tab accept, Esc closes.
  The built-in list mirrors the engines (`modules/jsonassert`): keep it in sync
- `src/frames.ts` — editor model only. It does **not** own the project format: the server
  (`server/.../format/`, spec `../docs/project-format.md`) parses/renders the `.md` files,
  applies script inheritance and validates on save; the API exchanges JSON. Execution is a
  server concern since phase 3: `{{bindings}}`, HTTP requests, mongo scripts and assertions
  run through `POST /api/v2/run` / `POST /api/v2/run/card`, so no template or endpoint parsing
  lives here anymore. Here: `framesFromApi` / `frameToApi` / `cardToApi` (JSON ↔ in-memory
  `Frame`/`Card`, card ids `{frame}/step-{n}/{var-file}`), `pickFrame`, `cardVarName`, and the
  name helpers mirrored from the server for live feedback (`slug`, `toVarName`,
  `normalizeVarName`, `varNameToFileName`).
- `src/catalog.ts` — the domain definitions served by the server (Phase 2): `loadCatalog()`
  (called once at boot, before frames load) fills `SOURCE_TYPES`, `HTTP_METHODS`,
  `DEFAULT_CARD_SIZE`/`DEFAULT_TIMEOUT`, `cardTypeOf` and `hasScripts`; `checkSourceCode()`
  answers the per-type code rule via `POST /api/v2/validate` (cached per code). No client
  copies of these rules exist anymore.
- `src/client-api/testframe.z.ts` — **every shape of the client as one zod file**: the editor
  model (`Card`, `Step`, `Frame`...), the wire shapes (`CardData`, `FrameData`, `SourceDef`,
  `CatalogEntry`...) and the framework API responses; types are `z.infer`red here, imports use
  this file directly (there is no `types.ts` anymore)

## Commands

```bash
bun install
bun run typecheck   # tsc --noEmit — must pass clean
bun run build       # vite build
bun run dev         # only with env from the root runner (bun run dev ./examples/<p>)
```

## Conventions

- No built-in project data: sources (and frames) come only from the project's files under
  `{project}/testframe/`. Hardcoded `SourceDef`s are allowed only as test mocks (e.g. `scripts/smoke.ts`).

- Strict TS: no implicit `any` in new params; component props typed via interfaces.
- Frames and sources cross the wire as JSON validated by the server: a rejected save is a 400
  `{status, message}` (`ApiError.reason`), and load problems come back in `errors`. Both surface
  in the execution console (source save errors also in the Sources tab), never as silent crashes.
- Cards never execute in the browser (phase 3): the whole flow runs through
  `POST /api/v2/run` (steps in order, cards in array order, first error stops the run) and a
  single card through `POST /api/v2/run/card` with the editor's current variables. The
  response's per-card outcomes drive the card status, the console line and the stored result;
  a rewritten JSON result card comes back in the outcome's `code`. If the server is down the
  run fails with an error log — there is no client-side fallback.
- Card files are `frames/{frame}/step-{n}/{var-file}.md` (var-name camelCase, kebab on disk,
  unique per frame). The header edits the frame name; cards bound to a source `script` keep
  an empty body on disk while they match it. Default var-names are English identifiers.
- The project comes from the URL (`?project=name`, see `main.tsx`); without it the start screen
  (`ProjectPicker`) lists recent projects (localStorage) and every project from `GET /api/v2/projects`,
  and can create a new one. The header's project icon goes back to it. The storage directory is
  always `slug(projectName)`; the app auto-loads saved frames/sources.
- Every run stores the card's last result (`{var-file}.result-data.md`, gitignored) and shows it
  under the card's script on the canvas; results reload with the project.
- On the server runner, `mongo` cards execute through the saved source's connection, request
  cards over real HTTP and `assert` cards through the Java engine; other source types stay
  simulated (they publish the step's JSON result card so later bindings resolve).
- The top tabs switch between Frames (canvas) and Sources (registry). There is no side inspector:
  cards are edited in `CardEditModal`; double-click on a card body still edits its code inline.
- Keep the Figma look (ring per status, floating console).
