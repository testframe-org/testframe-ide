# product-test (example project)

The reference TestFrame suite: what a saved project looks like end to end.

## Contents

| Path | What it is |
|---|---|
| `testframe/frames/` | flow `active-products-echo`: `step-{n}/{var-file}.md`, one card per file |
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

1. Step 1 runs the `mongo` script `getActiveProducts` (card `getActiveProducts`
   references `sources/mongo/products-db/get-active-products.md`) and
   publishes the result as the `getActiveProducts` variable.
2. Step 2 binds `{{getActiveProducts.0.nome}}` into a payload, sends it to
   the framework `POST /api/v2/echo`, and asserts the response with
   the `assertions-core` script `assertEchoProcessed` (`assert status == "PROCESSADO"`),
   executed live via `POST /api/v2/assertions`.

Regenerate the persisted frames/sources from the repo root:
`bun run example:push`.

Details per component: `examples-components/product-api/README.md`,
`examples-components/product-web/README.md`.
