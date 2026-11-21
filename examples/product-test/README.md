# product-test (example project)

The reference TestFrame suite: what a saved project looks like end to end.

## Contents

| Path | What it is |
|---|---|
| `testframe/frames/` | saved flow cards, one `.md` per card, named by `var-name` |
| `testframe/sources/` | where data comes from: mongo, swagger, restapi, assert, filter, mapper |
| `examples-components/product-api/` | Spring Boot 4 + MongoDB + Swagger - the business API under test |
| `examples-components/product-web/` | Vite + React + TS catalog - UI consumer of the API |
| `scripts/dev.ts` | component runner; ports from the repo-root `package.json > config` |

## Running

```bash
bun run product-test            # from the repo root (app only: api 18081, web 15174)
bun run product-test --api-only
bun run product-test --web-only
bun run example                 # plus the TestFrame IDE (18080/15173)
```

`product-api` needs MongoDB at the configured `mongoUri` (default
`mongodb://localhost:27017/products`); `DataSeeder` inserts three products the
first time the collection is empty.

## The suite

1. Step 1 queries active products (`mongo` script `obterProdutosAtivos`) and
   publishes them as the `obterProdutosAtivos` variable.
2. Step 2 binds `{{obterProdutosAtivos.0.nome}}` into a payload, sends it to
   the framework `POST /api/v2/echo`, and asserts the response with
   `assert $count(produtosAtivos) > 0` executed live via `POST /api/v2/assertions`.

Regenerate the persisted frames/sources from the repo root:
`bun run example:push`.

Details per component: `examples-components/product-api/README.md`,
`examples-components/product-web/README.md`.
