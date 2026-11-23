# AGENTS.md — product-api (example business API)

Spring Boot 4.2 + MongoDB (`spring-boot-starter-data-mongodb`) + Swagger/OpenAPI
(`springdoc-openapi-starter-webmvc-ui:3.2.1`). It is the **`openapi` source** of the `product-test`
example project: business logic lives here, never in the framework — the execution plugin
(`modules/testframe-plugin-spring`) is pure execution and the IDE (`modules/testframe-ide`) is pure
authoring.

All code, comments and docs in English.

## Run

```bash
./mvnw -q spring-boot:run    # needs mongod at mongodb://localhost:27017/products
```

Default port **18081**, resolved from the root `package.json > config.examples.product-test.serverPort`
and passed in by the root runner — do not hardcode a port anywhere else. Endpoints:

- OpenAPI spec: `http://localhost:18081/api/docs/openapi.json`
- Swagger UI: `http://localhost:18081/swagger-ui.html`

The example project consumes that spec URL as the `base-url` of its `product-api` openapi source
(`examples/product-test/testframe/sources.yaml`).

## Routes

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/products` | Optional filters `?categoria=` and `?ativos=true` |
| `GET` | `/api/products/{id}` | 404 when missing |
| `POST` | `/api/products` | 400 when `nome` is empty |
| `DELETE` | `/api/products/{id}` | 204 / 404 |

## Structure

- `domain/Product.java` — record `@Document("products")`
- `repository/ProductRepository.java` — MongoRepository + named queries
- `controller/ProductController.java` — annotated with `@Tag`/`@Operation`; keep Swagger mirroring
  the routes, because the IDE reads the operations from the spec and each openapi card names one by
  its `operationId`
- `bootstrap/DataSeeder.java` — seeds 3 products when the collection is empty; use a throwaway
  database if you want to reset it
- `config/OpenApiConfig.java` — API metadata

## Gotchas

- Boot 4 = Jackson 3; use `@JsonProperty` whenever a field name differs from the record's.
- The `product-web` client proxies `/api` → `:18081`; changing the route context (`/api/products`)
  means changing that proxy too.
- Renaming an `operationId` breaks the example cards that reference it — update
  `examples/product-test/testframe/frames/` in the same pass.
- The Mongo field names are pt-BR business data (`nome`, `categoria`, `preco`, `ativo`) and the
  example frames bind to them; renaming one means updating the frames too.
- No authentication: it is a local example.
