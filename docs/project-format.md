# Project format (`{project}/testframe/`)

How a TestFrame project is stored on disk. Contract owner: the framework server —
`server/.../format/` (envelope, naming rules, card/source codecs, validation; unit-tested
against the reference project byte for byte) and `server/.../store/ProjectFileStore.java`
(storage, path sanitization, replace semantics). Clients exchange JSON with the API and never
read or write these files themselves. Reference project: `examples/product-test/testframe/`.

The project is in beta: this format changes without migrations or legacy loaders
(see the root `AGENTS.md`).

## Principles

1. **The path is the identity.** Frame, step number, card variable, source type/name and
   script name are read from the path only. Frontmatter never repeats them, so renaming a
   file or folder cannot leave it contradicting its own frontmatter.
2. **Frontmatter stores only what the path cannot express**, and omits values equal to
   their defaults (`size`) or empty (`endpoint`, `source`). It may be empty.
3. **One envelope for every file:** a `-------------------` line, `key: value` lines and a
   closing `-------------------` line, then the body. Code bodies (cards and scripts) are a
   single fenced Markdown block tagged with the language of the source type; documentation
   bodies (source docs, private data) are plain Markdown.
4. **No duplicated code.** A card that runs a source script references it (`script:`)
   and stores an empty body. The card only has its own body when it overrides the script.
5. **Saving replaces.** Saving a frame replaces its whole directory, and saving a source
   replaces its files and script folder. Removed cards and scripts do not linger on disk.
6. **Private data sits next to what it belongs to** as `{name}.private.md` (gitignored),
   with an optional versioned template `{name}.private.example.md`.

## Layout

```
{project}/testframe/
  frames/
    {frame}/                       one flow (canvas), kebab-case, e.g. active-products-echo
      step-{n}/                    step number n (1-based, ordered numerically)
        {var-file}.md              one card; var-name = camelCase(var-file)
        {var-file}.private.md      optional private data of that card (gitignored)
  sources/
    {type-source}/                 e.g. mongo
      {name-source}.md             base-url + documentation
      {name-source}.private.md     optional private data (gitignored)
      {name-source}/               scripts of that source
        {script-file}.md           one custom query/method; script name = camelCase(script-file)
```

Any `*.private.md` may have a versioned `*.private.example.md` sibling (see below).

The names convert both ways: `getActiveProducts` ↔ `get-active-products.md`. Var-names
must be camelCase with no consecutive capitals (`getHttpData`, not `getHTTPData`), or the
round trip would lose information. The card editor normalizes input, and the server rejects
(400) var-names that do not survive the round trip and duplicate var-names within a frame,
because var-names are the binding identity. Script names follow the same camelCase rule;
source names match `[a-z0-9][a-z0-9._-]*` (at least 2 characters).

## Cards: `frames/{frame}/step-{n}/{var-file}.md`

| Key | Required | Meaning |
|---|---|---|
| `title` | yes | display name on the canvas (free text) |
| `order` | yes | 1-based position inside the step (cards run left to right) |
| `source` | no | `{type-source}/{name-source}` (or just `{type-source}`); omitted = inline |
| `script` | no | camelCase script of `source`; empty body = inherit it |
| `endpoint` | no | `METHOD /path` for requests (HTTP method is parsed from it) |
| `timeout` | no | ms (100–120000); default per type (request/js/sql 5000, jsonassert/json 2000, validation 1000) |
| `size` | no | `{width}x{height}`, only when different from the type default |
| `result-height` | no | px (24–600) of the last-run panel under the card's script |

Derived, never stored: card id (`{frame}/step-{n}/{var-file}`), step id/number,
var-name, http-method, and the card type, which follows the source type (`cardTypeOf`):
restapi/graphql/swagger → request, mongo (and kafka/grpc) → js, oracle/postgres/mysql/sqlserver
→ sql, filter/mapper → jsonassert, assert → validation, inline (no `source`) → json.

The fence language also follows the source type: mongo/restapi/graphql/kafka/grpc → `js`,
SQL types → `sql`, assert/filter/mapper → `jsonassert`, swagger/inline (and JSON outputs) →
`json` (`text` when the output is not JSON). A card that inherits a source script stores no
body at all.

## Sources: `sources/{type-source}/{name-source}.md`

- `{name-source}.md` has one frontmatter key, `base-url`. For `swagger` it points at the
  OpenAPI spec, which fully defines the endpoints, so swagger sources have no scripts.
  For `mongo` it is the connection URI, and for `restapi`/`assert` it is the service URL.
- `{name-source}.private.md` has an empty frontmatter. It is written only when it has content.
- `{name-source}/{script-file}.md` has an empty frontmatter, reserved for future script
  parameters. The body is the query or method as a fenced block. Allowed for every type
  except `swagger`.

## Private data: `*.private.md` / `*.private.example.md`

- Cards (`{var-file}.private.md`) and sources (`{name-source}.private.md`) keep secrets
  and access notes in a sibling file with an empty frontmatter. The IDE edits it in the
  card edit modal (cards) and the Sources tab (sources).
- `*.private.md` is gitignored. A versioned `*.private.example.md` next to it is the
  template: it is loaded when the private file is missing, and the next save writes the
  real `.private.md`. The server never deletes `*.private.example.md`.
- `bun run example:push` ships the example project with templates only.

## Last run: `{var-file}.result-data.md`

After a card runs (whole flow or the card editor's Run), the editor stores its last result next
to it: frontmatter `status`, `ran-at`, `elapsed`, `summary`; the body is the output fenced
as `json` (or `text` when it does not parse as JSON). The server adds `*.result-data.md` to the
project's `testframe/.gitignore`, keeps a result while its card exists and deletes it with the
card. The editor shows it under the card's script and in the card editor.

## Code rules per source type

`validateSourceCode` in `client/src/frames.ts` is enforced by the editor in the card editor,
before a run, before a frame save and before a source save (scripts). It moves to the server in
Phase 2 (see `TODO.md`):

| type-source | Accepted code |
|---|---|
| `mongo` | one mongo shell call: `db.<collection>.find\|findOne\|aggregate\|countDocuments\|distinct(...)`, optional `.sort/.skip/.limit`, `//` comments |
| `oracle` | one `SELECT` statement, `--` comments |
| `assert` | jsonassert lines only: `assert <expr> (==\|!=\|>\|>=\|<\|<=) <expr>`, `//` comments |

## Execution order

A step is one ordered sequence of cards (no pre/post phases). Cards run by `order`. A request
body comes from the nearest `json` card **before** the card; a request or mongo result is
written into the first `json` card **after** it and published as the card's variable.

An `assert` card evaluates against **every variable published so far in the frame**, as an
object keyed by var-name: `assert $count(activeProducts) > 0` reads the `activeProducts`
variable directly (`$` alone is the whole variables object).

## Bindings and references

- **Bindings between cards:** `{{varName}}` or `{{varName.path.0.field}}` in a JSON body
  resolves to the value published by an earlier card with that var-name. Var-names are
  unique per frame, so a binding is unambiguous.
- **Source scripts:** `source: mongo/products-db` + `script: getActiveProducts` points at
  `sources/mongo/products-db/get-active-products.md`. When the card body is empty, the
  server loads the script body into the card (from the saved sources). If the card's code
  still matches the saved script on save, the body is written empty again. If the user edits
  the code, it is saved as an override. A reference to a missing script loads with a warning
  (in `errors`, shown in the editor console).

## API

The API exchanges structured JSON; the server builds every path and file. Full shapes:
`server/AGENTS.md`.

- `GET /api/v2/frames/{project}` → `{frames, errors}`: frames sorted by name, steps renumbered
  from 1 in numeric order, cards by `order` (then var-name), each with its private data and last
  run. Invalid files are skipped and reported in `errors`.
- `POST /api/v2/frames` `{project, frame: {name, steps}}`: replaces `frames/{slug(name)}/`;
  other frames are untouched. Steps and cards are numbered by position.
- `POST /api/v2/frames/results` `{project, frame, step, varName, result}`: writes the card's
  `{var-file}.result-data.md`.
- `GET /api/v2/sources/{project}` → `{sources}`; `POST /api/v2/sources` `{project, sources}`:
  for each sent source, `{type}/{name}.md`, `{type}/{name}.private.md` and the `{type}/{name}/`
  script folder are replaced. Sources that are not sent are untouched.
- Invalid data is rejected with 400 `{status, message}` before anything is written. The store
  still validates every path: it strips `..`, applies a character whitelist, checks that the
  path stays under the projects dir, accepts only `.md` files, and never allows a scope equal
  to the `frames/` or `sources/` root.

## Example

````
frames/active-products-echo/
  step-1/get-active-products.md  active-products.md  assert-active-products.md
  step-2/echo-payload.md  send-echo.md  send-echo.private.example.md  echo-result.md  assert-echo.md
sources/
  mongo/products-db.md  mongo/products-db/{get-active-products, get-products-by-category}.md
  swagger/product-api.md  swagger/product-api.private.example.md

# frames/active-products-echo/step-1/get-active-products.md
-------------------
title: Get active products
order: 1
source: mongo/products-db
script: getActiveProducts
timeout: 5000
-------------------

# frames/active-products-echo/step-1/assert-active-products.md
-------------------
title: Assert active products
order: 3
source: assert/assertions-core
timeout: 1000
-------------------
```jsonassert
assert $count(activeProducts) > 0
```

# sources/mongo/products-db.md
-------------------
base-url: mongodb://localhost:27017/products
-------------------
````

## Notes

- The client shows one frame at a time: the one named in the header, or the first one on
  disk. Saving writes only that frame.
