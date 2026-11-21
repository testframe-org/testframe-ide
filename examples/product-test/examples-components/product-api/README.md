# product-api

Example business API for the product-test suite: Spring Boot 4 + MongoDB +
Swagger. It is deliberately outside the framework - the framework only knows
how to call it.

## Endpoints

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/products` | filters: `?categoria=`, `?ativos=true` |
| `GET` | `/api/products/{id}` | 404 when missing |
| `POST` | `/api/products` | 201; `nome` required (400 otherwise) |
| `DELETE` | `/api/products/{id}` | 204 |

API docs: Swagger UI at `/swagger-ui.html`, OpenAPI 3.1 spec at
`/api/docs/openapi.json` (the `swagger` source in `testframe/sources` points
`base-url` at this spec - endpoints match it 100%).

## Running

```bash
bun run product-test --api-only     # from repo root (port 18081)
# or directly:
./mvnw -q spring-boot:run           # SERVER_PORT env overrides the default
```

Requires MongoDB (`mongodb://localhost:27017/products` by default).
`DataSeeder` populates three products when the collection is empty:
`Kit Testes E2E`, `Licenca TestFrame`, `Mouse Legacy` (inactive).

## Tests

```bash
./mvnw -q test    # controller + seeder checks; Mongo test container style slices
```

Rules in `AGENTS.md`.
