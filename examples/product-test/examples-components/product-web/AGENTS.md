# AGENTS.md — product-web (example web app)

Vite + React + TypeScript, no Tailwind (a single stylesheet at `src/index.css`). It consumes
`product-api` through a proxy — the front-end half of the `product-test` example, and one of the
targets the example project's frames assert against.

All code, comments and docs in English. The UI copy of this example stays pt-BR on purpose: it is
sample business data, not testframe's own UI (which is i18n en / pt-BR).

## Run

```bash
bun install
bun run dev      # http://localhost:15174 (strictPort)
bun run build
```

Port 15174 and the proxy `/api` → `http://localhost:18081` live in `vite.config.ts`. The port is
resolved from the root `package.json > config.examples.product-test.clientPort` and passed in by the
root runner.

## Structure

- `src/App.tsx` — the catalog: filtered list, creation (name/category/price), active/inactive toggle
  (re-posts the document), deletion. The `api<T>()` helper centralizes fetch + HTTP error handling.
- `Product` mirrors the `product-api` record — when the backend payload changes, update this
  interface, `DataSeeder` and the docs together.

## Conventions

- Every network call goes through `api<T>()` with an explicit return type; no loose `fetch` in
  components.
- API errors surface in the banner — never swallow them with `.catch(() => {})`.
