# product-test (example project)

The reference TestFrame suite: what a saved project looks like end to end.

## Contents

| Path | What it is |
|---|---|
| `testframe/frames/` | flow `active-products-echo`: `step-{n}/{var-file}.md`, one card per file |
| `testframe/sources/` | where data comes from, connection only: `mongo/products-db`, `openapi/product-api` (the product-api OpenAPI spec) |
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

1. Step 1 runs a `mongo` `find` card (`source: mongo/products-db`, `subtype: find`,
   `collection: products`, JSON body `{ "filter": { "ativo": true } }`) and publishes the result as the
   `getActiveProducts` variable; a `rawvalue`/`json` card and a `jsonassert`/`script` card follow.
2. Step 2 binds `{{getActiveProducts.0.*}}` into a payload and sends it to the product-api
   operation `create` (`POST /api/products`, picked from the `openapi/product-api` source's
   cached spec); the copy is created inactive, so step 1 stays stable across runs. The response
   feeds the `createdProduct` card and a `jsonassert`/`script` card checks it
   (`assert createdProduct.categoria == getActiveProducts[0].categoria`).

The openapi source's operations are cached in `testframe/sources/openapi/product-api.cache.md`
(gitignored) when the source is saved in the Sources tab, or on first use.

Regenerate the persisted frames from the repo root (sources are edited by hand or in the Sources tab):
`bun run example:push`.

Details per component: `examples-components/product-api/README.md`,
`examples-components/product-web/README.md`.
