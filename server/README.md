# testframe-server

Framework server for TestFrame: stores projects as markdown and executes the
generic parts of a suite run. Pure infrastructure - no business logic lives
here (example APIs belong in `../../examples/*/examples-components/`).

## Endpoints

| Route | Purpose |
|---|---|
| `GET  /api/v2/health` | service status |
| `POST /api/v2/echo` | generic request target for flows under test (201 + request_id) |
| `POST /api/v2/assertions` | evaluates the assertion mini-language (engine: `jsonassert-java` (`io.github.jsonassert`)) |
| `POST /api/v2/frames` / `GET /api/v2/frames/{project}` | replace/read frame directories (`{frame}/step-{n}/{var-file}.md`) |
| `POST /api/v2/sources` / `GET /api/v2/sources/{project}` | replace/read sources (`{type}/{name}.md`, `.private.md`, `{name}/{script}.md`) |

On-disk format: `../docs/project-format.md`.

## Stack

Spring Boot 4 (web MVC) on Java 21, Maven wrapper, Jackson 3. Storage root is
`--app.projects-dir` (env `APP_PROJECTS_DIR`); file writes are atomic and paths
are sanitized against traversal.

## Running

Started by the IDE module scripts with parameters (`--serverPort`, `--projectsRoot`);
standalone:

```bash
SERVER_PORT=18080 ./mvnw -q spring-boot:run \
  -Dspring-boot.run.arguments=--app.projects-dir=../../../examples
```

Requires the `jsonassert-java` (`io.github.jsonassert`) artifact installed in the local Maven repo
(`cd ../../jsonassert && bun run install:java`).

## Commands

```bash
./mvnw -q test
./mvnw -q -DskipTests package
```

Rules and gotchas in `AGENTS.md`.
