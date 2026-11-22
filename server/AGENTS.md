# AGENTS.md — testframe-server (framework)

Spring Boot 4.2 (web MVC) + Maven wrapper. A **framework** server: infrastructure only for TestFrame — no business logic here (it belongs in `examples/.../examples-components/`).

All code comments and messages are in English.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/v2/health` | service status |
| `POST /api/v2/echo` | generic target for in-test flow requests (201 with `request_id`) |
| `GET /api/v2/frames/{project}` | `{frames: [{name, steps: [{number, cards: [Card]}]}], errors}`; Card = `{varName, title, type, sourceType, subtype, collection, sourceName, endpoint, openapiId, httpMethod, timeout, width, height, resultHeight, code, privateData, lastRun}` (`lastRun` = `{status, text, output, at, ranAt}` or null). Cards come in the order of the step's `flow.md`; invalid files, flow mismatches and openapi cards out of date with their source's cached operations (`openapi-id` missing, or `endpoint` no longer its method + path) are reported in `errors` |
| `POST /api/v2/frames` | `{project, frame: {name, steps}}`: validates (unique, round-trip-safe var-names; frontmatter schema: `source` mandatory, `subtype` per type, `collection` required on (and only on) mongo cards, `openapi-id` only on openapi cards, no `script`; code rules), serializes and replaces `frames/{slug(name)}/`. Steps are numbered by position and each step's card sequence is stored in its `flow.md`; `type`/`httpMethod`/`lastRun` are ignored; null `timeout`/`width`/`height` = defaults of the card type |
| `POST /api/v2/frames/results` | `{project, frame, step, varName, result}`: stores a card's last run (`{frame}/step-{n}/{var-file}.cache.md`) and ensures `testframe/.gitignore` ignores `*.cache.md` |
| `GET /api/v2/sources/{project}` | `{sources: [{typeSource, name, baseUrl, privateData}], errors}`: a source is only its connection; invalid source files (a body, keys other than `base-url`, a sourceless type) are skipped and reported |
| `POST /api/v2/sources` | `{project, sources}`: validates (type with named sources, name pattern) and replaces each sent source (`{type}/{name}.md`, `{name}.private.md`); each saved openapi source then rewrites its operations cache (`{name}.cache.md`); a spec that cannot be read comes back in `warnings` |
| `GET /api/v2/sources/openapi/{name}/operations?project=` | `{specUrl, baseUrl, fetchedAt, operations: [{operationId, method, path, summary}]}` read from the source's cache (fetched once when missing; 404 without the source, 502 when the spec cannot be read) |
| `GET /api/v2/projects` | projects under the projects dir (folders with `testframe/`), most recent first |
| `GET /api/v2/catalog` | `{sourceTypes: [{name, language, hasSources, subtypes, cards: [{subtype, cardType, language, form, defaultWidth, defaultHeight, defaultTimeout}]}], httpMethods}`: the source types with their card subtypes, the domain definitions the editor consumes (it keeps no local copies) |
| `POST /api/v2/validate` | `{sourceType, subtype, code}` → `{problem}` (null when acceptable): the code rule of the (type, subtype) (`format/CodeRules`, enforced on frame saves and by the runner) |
| `POST /api/v2/run` | `{project, frame, steps: [{number, cards}]}`: runs a whole frame server-side: steps in the sent order, cards in array order, stopping at the first error card; a jsonassert `conditional` that is false skips the rest of its step (outcomes `skipped`) and the run goes on with the next step. Returns `{project, frame, results: [{varName, status, text, output, at, ranAt, code}], vars}` (status success/error/skipped; `code` only when the run rewrote that JSON result card's body) plus every published variable. The runner checks each card's (type, subtype) and `CodeRules` first, resolves `{{varName.path}}` bindings (`runner/Bindings`), executes openapi request cards over `java.net.http` against the `api-base` of their source's cached spec (resolved by `openapi-id`; cards without name-source send relative paths to the framework server itself), mongo cards through the shared `MongoRunner` and jsonassert cards through the Java engine (`JsonassertParser` + `JsonataEvaluator` for expressions, `JsonataAssertionService` for assert lines) |
| `POST /api/v2/run/card` | `{project, step, card, vars, payload, resultCard}`: the same engine for one card (the editor's Run button). `vars` are the variables the editor already has, `payload` the code of the nearest JSON card before it (the request body), `resultCard` the first JSON card after it (`{varName, code}`): a successful run publishes that variable; returns `{result, vars}` |
| `POST /api/v2/run/mongo` | `{project, source, subtype, collection, body}`: runs one mongo JSON body (`find` or `aggregation`, read-only) with Spring Data `MongoTemplate`; the body is validated before the source is read; the connection is the `base-url` of `sources/mongo/{source}.md` |
| `GET /api/v2/openapi.json` | static OpenAPI spec of the framework's own in-test targets (`echo`, `health`), so an openapi source can point at the framework server |

Errors are `{status, message}` (`controller/ApiExceptionHandler`): `ResponseStatusException`
keeps its status, `format.FormatException` (data that cannot be stored) is a 400 whose message
joins every problem with `; `.

## Structure

- `controller/` — FrameworkController, FrameController, SourceController, RunnerController
  (card runs `POST /run` + `/run/card`, mongo bodies `/run/mongo`), ProjectController,
  AssertionController, DomainController (catalog + validate),
  ApiExceptionHandler (`@RestControllerAdvice`)
- `format/` — **owner of the on-disk project format** (spec: `../docs/project-format.md`), plain
  classes without Spring, unit-tested (including a byte-exact round trip of every committed
  example file): `MdEnvelope` (frontmatter/body envelope), `Names` (slug, var-name ↔ kebab file
  name, camelCase and source-name rules), `Catalog` (source types with their card subtypes,
  `cardTypeOf`/`languageOf` per (type, subtype), `subtypeProblem`, default size/timeout per card
  type, HTTP methods), `CodeRules` (code rules per (type, subtype): mongo, sql/oracle, jsonassert),
  `MongoQuery` (the mongo JSON body per subtype: parsing, read-only and unknown-key checks),
  `JsonassertCode` (jsonassert `script`/`conditional` bodies, parsed by the engine's parsers),
  `CardCodec` (card frontmatter, private and `cache` siblings), `FrameCodec` (frame directory ↔
  `Frame`, var-name validation), `SourceCodec` (source files ↔ `Source`: only `base-url`, validation). Format changes happen here first; the
  client only maps the JSON.
- `runner/` (besides mongo) — `HttpRequestRunner` executes the request cards' HTTP calls
  (java.net.http; `resolveUrl` maps relative endpoint paths onto `service/LocalServerUrl`, the
  framework server's own base URL, captured when the web server starts); `Bindings` resolves
  the `{{varName.path}}` templates against the variables published so far (whole-string
  templates keep the value's JSON type, inline ones are JSON-encoded; unresolved stay as written).
- `openapi/` — `OpenApiSpec` (an OpenAPI/Swagger 2 document distilled to its API base and
  operations `{operationId, method, path, summary}`; the `{name}.cache.md` codec) and
  `OpenApiService` (reads a source's cache, fetching the spec once when missing; rewritten on
  source save). The fetch is a swappable `Fetcher` (tests mock it).
- `service/` — `FrameService` / `SourceService`: codecs + `ProjectFileStore` (base-url and cache
  files for the runners; openapi endpoint warnings on load); `RunService`: the card runner engine
  behind `POST /api/v2/run` and `POST /api/v2/run/card` (card order, bindings, publishing, the
  JSON result card that receives a run's payload, conditional skips and the first-error stop)
- `store/ProjectFileStore.java` — atomic writes (tmp + move), **path sanitization** (strip `..`, character whitelist, `startsWith` guard, `.md` only) and `replace(...)` (writes, then prunes stale `.md` files and empty dirs inside each scope; a scope can never be the `frames/`/`sources/` root). All paths are validated before anything is written. Keep these validations in any new endpoint that accepts a path. Format spec: `../docs/project-format.md`.
- `config/WebConfig.java` — CORS with `allowedOriginPatterns("http://localhost:[*]")`
- DTOs are `record`s under `dto/`

## Configuration

- `app.projects-dir` (env `APP_PROJECTS_DIR`, arg `--app.projects-dir`) → root under which `{project}/testframe/{frames,sources}` lives. The runner injects `../examples`.
- Port: never hardcoded in properties; the runner passes `SERVER_PORT`/`--server.port` from the root `package.json` config.

## Lombok

The Boot-managed `org.projectlombok:lombok` (provided, optional) generates the DTO record
withers: `@With` on `dto/Card` and `dto/CardResult` — never hand-write copy/with boilerplate —
and `@Slf4j` covers logging. The compiler plugin lists Lombok in `annotationProcessorPaths`
because JDK 23+ does not run classpath annotation processors on its own.

## Mongo runner

- `format/MongoQuery` parses the card's query: the `collection` from the card's frontmatter (`collectionProblem`: non-empty, no `$`/null char, not `system.*`) and the JSON body, subtype `find` `{filter?, projection?, sort?, limit?, skip?}` or `aggregation` `{pipeline}` (strict JSON, extended JSON values understood; unknown keys and write stages `$out`/`$merge` rejected; `{{bindings}}` resolved before parsing at run time); `runner/MongoRunner` executes it with one `MongoTemplate` per base-url (lazy, 3s server-selection timeout, max 1000 docs).
- **No server-side Mongo configuration:** Boot's Mongo / Data Mongo auto-configurations are excluded in `ServerApplication`; every connection comes from the edited project's source file. Writes are rejected.

## Gotchas

- Boot 4 ships **Jackson 3**: package `tools.jackson.*`; `com.fasterxml.jackson.databind` does not exist. Use `@JsonProperty` (from `com.fasterxml.jackson.annotation`) for property naming.
- Starters were renamed: `spring-boot-starter-webmvc` / `spring-boot-starter-webmvc-test`.

## Commands

```bash
./mvnw -q compile          # fast build
./mvnw -q test             # suite
./mvnw -q spring-boot:run  # standalone (../examples defaults)
```

Manual validation with the stack up: `bun run smoke` (from the root).
