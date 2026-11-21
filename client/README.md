# testframe-client

Visual flow editor for TestFrame suites: a Figma-style canvas of steps, each
split into PRE-EXECUTION (scripts, payloads, requests) and POST-EXECUTION
(JSON results, assertions) cards.

## Stack

Vite 8 + React 19 + TypeScript (strict) + Tailwind v4 + zod v4 + lucide-react.

## Structure

- `src/App.tsx` - canvas, pan/zoom, execution loop, frame save/load
- `src/i18n.tsx` - all UI strings in en/pt-BR dictionaries; toggle in the header
- `src/client-api/` - the only place fetch is allowed (framework + target calls)
- `src/components/` - StepFrame, TestBlockCard, InspectorPanel, SourcesModal, ExecutionConsole...
- `src/frames.ts` - persistence contract: `.md` serialization + zod schemas +
  `{{varName}}` template resolution

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
