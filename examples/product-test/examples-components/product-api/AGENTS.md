# AGENTS.md — product-api (exemplo de negócio)

Spring Boot 4.2 + MongoDB (`spring-boot-starter-data-mongodb`) + Swagger/OpenAPI (`springdoc-openapi-starter-webmvc-ui:3.2.1`). É o **source restapi/swagger** do exemplo `product-test` — regra de negócio vive aqui, nunca no `server/` do framework.

## Rodar

```bash
./mvnw -q spring-boot:run    # exige mongod em mongodb://localhost:27017/products
```

Porta fixa de exemplo: **18081** (`application.properties`). Docs:

- OpenAPI: `http://localhost:18081/api/docs/openapi.json`
- Swagger UI: `http://localhost:18081/swagger-ui.html`

## Rotas

| Método | Rota | Observação |
|---|---|---|
| `GET` | `/api/products` | filtros opcionais `?categoria=` e `?ativos=true` |
| `GET` | `/api/products/{id}` | 404 se não existir |
| `POST` | `/api/products` | 400 se `nome` vazio |
| `DELETE` | `/api/products/{id}` | 204 / 404 |

## Estrutura

- `domain/Product.java` — record `@Document("products")`
- `repository/ProductRepository.java` — MongoRepository + queries nomeadas
- `controller/ProductController.java` — anotado com `@Tag`/`@Operation` (mantenha o swagger espelhando as rotas)
- `bootstrap/DataSeeder.java` — popula 3 produtos se a coleção estiver vazia; rode o Mongo com db descartável se quiser resetar
- `config/OpenApiConfig.java` — metadados da API

## Gotchas

- Boot 4 = Jackson 3; nomes de campo via `@JsonProperty` quando diferir do record.
- O client `product-web` faz proxy `/api` → `:18081`; mexer no contexto de rota (`/api/products`) exige ajustar o proxy de lá.
- Não há autenticação — é exemplo local.
