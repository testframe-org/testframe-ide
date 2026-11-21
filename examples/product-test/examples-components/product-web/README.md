# product-web

Example UI for the product-test suite: Vite + React + TypeScript catalog of
the products exposed by `product-api`. It exercises the same source the
`swagger` entry describes.

## Running

```bash
bun run product-test --web-only   # from repo root (port 15174)
# or directly:
bun install && bun run dev        # CLIENT_PORT / API_PORT envs configure it
```

The dev server proxies `/api` to the API (`API_PORT`, default 18081).

## What it does

- lists products (price in BRL, active/inactive badges)
- creates products via the form (POST)
- toggles `ativo` (re-POST with the doc) and deletes (DELETE)
- centralizes all calls in a typed `api<T>()` helper; errors show in a banner

## Commands

```bash
bun run typecheck
bun run build
```

Rules in `../product-api/AGENTS.md` and the project-level `AGENTS.md`
(`../../AGENTS.md`).
