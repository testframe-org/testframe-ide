# AGENTS.md — testframe-ide client (editor)

Vite 8 + React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite`) + `lucide-react` + `zod` v4. Managed with **bun**. All code, comments and docs in English; UI copy goes through i18n (en / pt-BR).

## Structure

- `src/App.tsx` — main canvas (pan/zoom, steps, cards, flow execution, save/load frames)
- `src/i18n.tsx` — `I18nProvider` + `useI18n()`: every user-visible string lives in the
  `en` dictionary (authoritative); the `pt` dictionary is typed `Record<TKey, string>` so
  a missing translation fails the typecheck. Language persists to localStorage; toggle in the header.
- `src/client-api/` — network layer: `http.ts` (`requestJson` + `ApiError`), `testframe.ts`
  (framework endpoints), `target.ts` (`runTargetRequest` for flow requests, timed). No `fetch`
  calls outside this folder except card-driven target dispatch.
- `src/components/` — `StepFrame`, `TestBlockCard`, `ConnectorArrow`, `AddBlockCircleButton`,
  `CardEditModal` (opened by a card's Edit button: general fields on the left, `SourceForm` on the right),
  `SourceForm` (one form per type-source: http, swagger, query, assert, json, expression, code),
  `ExecutionConsole`, `SourcesView` (the Sources tab: source CRUD incl. the scripts editor)
- `src/frames.ts` — editor model and runtime helpers. It does **not** own the project format:
  the server (`server/.../format/`, spec `../docs/project-format.md`) parses/renders the `.md`
  files, applies script inheritance and validates on save; the API exchanges JSON.
  Here: `framesFromApi` / `frameToApi` (JSON ↔ in-memory `Frame`/`Card`, card ids
  `{frame}/step-{n}/{var-file}`), `pickFrame`, `cardVarName`, name helpers mirrored from the
  server for live feedback (`slug`, `toVarName`, `normalizeVarName`, `varNameToFileName`),
  `endpointParts` and `substituteTemplates` for `{{varName.path}}` bindings (runner, Phase 3).
- `src/catalog.ts` — the domain definitions served by the server (Phase 2): `loadCatalog()`
  (called once at boot, before frames load) fills `SOURCE_TYPES`, `HTTP_METHODS`,
  `DEFAULT_CARD_SIZE`/`DEFAULT_TIMEOUT`, `cardTypeOf` and `hasScripts`; `checkSourceCode()`
  answers the per-type code rule via `POST /api/v2/validate` (cached per code). No client
  copies of these rules exist anymore.
- `src/types.ts` — domain types (`Card`, `Step`, `SourceDef`, `HttpResult`...) and the wire
  shapes (`CardData`, `FrameData`, `FramesLoadResponse`, `CatalogEntry`, `CatalogResponse`)

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
- Requests execute live against the framework (`POST /api/v2/echo`) when the endpoint
  matches `METHOD /path`; validation cards starting with `assert` execute live against
  `POST /api/v2/assertions`; responses feed the step's JSON result card and publish
  variables named after each card's `var-name`.
- Card files are `frames/{frame}/step-{n}/{var-file}.md` (var-name camelCase, kebab on disk,
  unique per frame). The header edits the frame name; cards bound to a source `script` keep
  an empty body on disk while they match it. Default var-names are English identifiers.
- The project comes from the URL (`?project=name`, see `main.tsx`); without it the start screen
  (`ProjectPicker`) lists recent projects (localStorage) and every project from `GET /api/v2/projects`,
  and can create a new one. The header's project icon goes back to it. The storage directory is
  always `slug(projectName)`; the app auto-loads saved frames/sources.
- Every run stores the card's last result (`{var-file}.result-data.md`, gitignored) and shows it
  under the card's script on the canvas; results reload with the project.
- `mongo` cards run live through `POST /api/v2/run/mongo` (the server reads the connection from the
  saved source file); request and assert cards also run live; other source types are simulated.
- The top tabs switch between Frames (canvas) and Sources (registry). There is no side inspector:
  cards are edited in `CardEditModal`; double-click on a card body still edits its code inline.
- Keep the Figma look (ring per status, floating console).
