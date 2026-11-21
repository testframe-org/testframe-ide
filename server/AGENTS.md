# AGENTS.md — testframe-server (framework)

Spring Boot 4.2 (web MVC) + Maven wrapper. A **framework** server: infrastructure only for TestFrame — no business logic here (it belongs in `examples/.../examples-components/`).

All code comments and messages are in English.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/v2/health` | service status |
| `POST /api/v2/echo` | generic target for in-test flow requests (201 with `request_id`) |
| `POST /api/v2/frames` | replaces frame directories (`{frame}/step-{n}/{var-file}.md`) |
| `GET /api/v2/frames/{project}` | reads saved frames |
| `POST /api/v2/sources` | replaces source directories (`public-data.md`/`private-data.md`/`scripts/*.md`) |
| `GET /api/v2/sources/{project}` | reads sources |

## Structure

- `controller/` — FrameworkController, FrameController, SourceController
- `store/ProjectFileStore.java` — atomic writes (tmp + move), **path sanitization** (strip `..`, character whitelist, `startsWith` guard, `.md` only) and `replace(...)` (writes, then prunes stale `.md` files and empty dirs inside each scope; a scope can never be the `frames/`/`sources/` root). All paths are validated before anything is written. Keep these validations in any new endpoint that accepts a path. Format spec: `../docs/project-format.md`.
- `config/WebConfig.java` — CORS with `allowedOriginPatterns("http://localhost:[*]")`
- DTOs are `record`s under `dto/`

## Configuration

- `app.projects-dir` (env `APP_PROJECTS_DIR`, arg `--app.projects-dir`) → root under which `{project}/testframe/{frames,sources}` lives. The runner injects `../examples`.
- Port: never hardcoded in properties; the runner passes `SERVER_PORT`/`--server.port` from the root `package.json` config.

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
