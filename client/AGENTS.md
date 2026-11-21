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
- `src/frames.ts` — **persistence contract** (spec: `../docs/project-format.md`): card/source
  `.md` serialization + zod schemas (`cardFrontmatterSchema`, `sourceSchema`) +
  `buildFrameFiles(frame, steps, sources)` / `rebuildFrames(files, sources)` / `pickFrame` +
  `wrapSourcesForSave` / `unwrapSourcesFromLoad` + name helpers (`normalizeVarName`,
  `varNameToFileName`, `fileNameToVarName`) + `substituteTemplates` for `{{varName.path}}`
  bindings. Identity (frame, step, var-name, source, script) comes from the path only.
  Changes here must stay in sync with the server (`server/.../store/ProjectFileStore.java`).
- `src/types.ts` — domain types (`Card`, `Step`, `SourceDef`, `ScriptFile`, `RawSource`, `HttpResult`...)

## Commands

```bash
bun install
bun run typecheck   # tsc --noEmit — must pass clean
bun run build       # vite build
bun run dev         # only with env from the root runner (bun run dev ./examples/<p>)
```

## Conventions

- Strict TS: no implicit `any` in new params; component props typed via interfaces.
- Anything crossing the wire (frame frontmatter, sources) is validated with zod before
  send/accept. Schema errors surface in the execution console, never as silent crashes.
- Requests execute live against the framework (`POST /api/v2/echo`) when the endpoint
  matches `METHOD /path`; validation cards starting with `assert` execute live against
  `POST /api/v2/assertions`; responses feed the step's JSON result card and publish
  variables named after each card's `var-name`.
- Card files are `frames/{frame}/step-{n}/{var-file}.md` (var-name camelCase, kebab on disk,
  unique per frame). The header edits the frame name; cards bound to a source `script` keep
  an empty body on disk while they match it. Default var-names are English identifiers.
- Project name defaults to `VITE_PROJECT` (fallback `product-test`); the storage directory
  is always `slug(projectName)`. The app starts empty and auto-loads saved frames/sources.
- The top tabs switch between Frames (canvas) and Sources (registry). There is no side inspector:
  cards are edited in `CardEditModal`; double-click on a card body still edits its code inline.
- Keep the Figma look (ring per status, floating console).
