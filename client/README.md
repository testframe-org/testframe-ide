# testframe-client

Visual flow editor for TestFrame suites: a Figma-style canvas of steps, each
one ordered sequence of cards (scripts, payloads, requests, JSON results,
assertions) executed left to right.

## Stack

Vite 8 + React 19 + TypeScript (strict) + Tailwind v4 + zod v4 + lucide-react.

## Structure

- `src/App.tsx` - canvas, pan/zoom, execution loop, frame save/load
- `src/i18n.tsx` - all UI strings in en/pt-BR dictionaries; toggle in the header
- `src/client-api/` - the only place fetch is allowed (framework + target calls)
- `src/components/` - StepFrame, TestBlockCard, CardEditModal, SourceForm, SourcesView, ExecutionConsole...
- `src/frames.ts` - editor model (JSON from the framework API ↔ canvas cards), code rules per
  source type and `{{varName}}` template resolution; the `.md` format is owned by the server

## Running

Started by the root orchestration (`bun run dev`); standalone:

```bash
CLIENT_PORT=15173 VITE_SERVER_PORT=18080 VITE_PROJECT=product-test bun run dev
```

The dev server proxies `/api` to the framework server.

## Commands

```bash
bun install
bun run typecheck
bun run build
```

The app starts empty and auto-loads frames/sources saved for the project.
Every user-visible string goes through `useI18n()` - see `AGENTS.md`.
