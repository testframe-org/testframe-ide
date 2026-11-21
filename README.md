# testframe-ide

The IDE umbrella: the visual flow editor (React client) and the framework
server (Spring Boot) that persists test projects as markdown.

## Contents

| Path | Description |
|---|---|
| `client/` | Vite + React + TS canvas editor (Frames/Sources tabs, steps, cards, card edit modal) |
| `server/` | Spring Boot framework server: frames/sources persistence, echo, assertions |
| `scripts/` | Parameter-driven runners (all settings arrive as `--key=value`) |
| `examples/` | Example projects, each a self-contained suite with its own README |
| `docs/project-format.md` | On-disk project format (frames/sources layout, frontmatter, bindings) |

Ports: server 18080, client 15173 (defaults documented in the root
`package.json > config` - the repo-root `scripts/` resolve them and pass
values here as parameters; this module never reads the root config).

## Commands

Run from the repo root:

```bash
bun run dev                    # server + client at examples/product-test
bun run dev --config.serverPort=18090   # any setting overridable via --config.*
```

Directly here (parameter-driven):

```bash
bun scripts/dev.ts --serverPort=18080 --clientPort=15173 \
  --projectsRoot=<abs/examples/dir> --project=product-test
bun scripts/dev-server.ts --serverPort=18080 --projectsRoot=<abs/examples/dir>
bun scripts/dev-client.ts --clientPort=15173 --serverPort=18080 --project=product-test
bun run build                  # client dist + server jar
bun run test                   # server suite + client build
```

The server build needs the `jsonassert-java` (`io.github.jsonassert`) library installed into the
local Maven repo; `scripts/dev*.ts` do it automatically.

See `AGENTS.md` for rules, and `client/README.md` / `server/README.md` /
`examples/product-test/README.md` per subproject.
