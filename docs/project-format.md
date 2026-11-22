# Project format (`{project}/testframe/`)

How a TestFrame project is stored on disk. Contract owner: the framework server —
`server/.../format/` (envelope, naming rules, catalog, card/source codecs, code rules; unit-tested
against the reference project byte for byte) and `server/.../store/ProjectFileStore.java`
(storage, path sanitization, replace semantics). Clients exchange JSON with the API and never
read or write these files themselves. Reference project: `examples/product-test/testframe/`.

The project is in beta: this format changes without migrations or legacy loaders
(see the root `AGENTS.md`).

## Principles

1. **The path is the identity.** Frame, step number, card variable and source type/name are
   read from the path only. Frontmatter never repeats them, so renaming a file or folder
   cannot leave it contradicting its own frontmatter.
2. **Frontmatter stores only what the path cannot express**, and omits values equal to
   their defaults (`size`) or empty (`endpoint`). It may be empty.
3. **One envelope for every file:** a `-------------------` line, `key: value` lines and a
   closing `-------------------` line, then the body. A card's body is a single fenced
   Markdown block tagged with the language of its (type-source, subtype).
4. **Every card declares its type-source** (`source:`), and its **subtype** when the type has
   subtypes. A card always holds its own code: sources have no scripts.
5. **A source is only its connection:** `{type}/{name}.md` holds `base-url` and nothing else.
6. **Saving replaces.** Saving a frame replaces its whole directory, and saving a source
   replaces its files. Removed cards do not linger on disk.
7. **Private data sits next to what it belongs to** as `{name}.private.md`, always gitignored.
   There are no versioned templates.
8. **Generated local files end in `.cache.md`** (a card's last run, an openapi source's
   operations) and are gitignored (`testframe/.gitignore`: `*.cache.md`).

## Layout

```
{project}/testframe/
  .gitignore                       *.cache.md (written by the server)
  frames/
    {frame}/                       one flow (canvas), kebab-case, e.g. active-products-echo
      step-{n}/                    step number n (1-based, ordered numerically)
        flow.md                    the step's card sequence: one card file name per line, in order
        {var-file}.md              one card; var-name = camelCase(var-file)
        {var-file}.private.md      optional private data of that card (gitignored)
        {var-file}.cache.md        last run of that card (generated, gitignored)
  sources/
    {type-source}/                 openapi, mongo, sql, kafka, grpc
      {name-source}.md             frontmatter base-url, no body
      {name-source}.private.md     optional private data (gitignored)
      {name-source}.cache.md       openapi only: the spec's cached operations (generated, gitignored)
```

The names convert both ways: `getActiveProducts` ↔ `get-active-products.md`. Var-names
must be camelCase with no consecutive capitals (`getHttpData`, not `getHTTPData`), or the
round trip would lose information. The card editor normalizes input, and the server rejects
(400) var-names that do not survive the round trip and duplicate var-names within a frame,
because var-names are the binding identity. Source names match `[a-z0-9][a-z0-9._-]*` (at
least 2 characters) and cannot end in `.cache` or `.private`.

## Source types and subtypes

Every source has a TYPE; a card bound to it picks a SUBTYPE of that type. The table lives in
the server catalog (`format/Catalog`, served by `GET /api/v2/catalog`); the editor keeps no copy.

| type | named sources | subtypes (card-level) | card type | fence | notes |
|---|---|---|---|---|---|
| `openapi` | yes | `restapi`, `swagger`, `graphql` | request | `js` (`json` for swagger) | `base-url` is the OpenAPI spec JSON; cards pick one of its operations |
| `mongo` | yes | `find`, `aggregation` | query | `json` | body is one JSON object (see below), read-only |
| `sql` | yes | `oracle`, `postgres`, `mysql`, `sqlserver` | sql | `sql` | |
| `jsonassert` | no | `script`, `conditional` | jsonassert (script) / condition (conditional) | `jsonassert` | code always lives in the card (see below) |
| `kafka`, `grpc` | yes | — | js | `js` | |
| `rawvalue` | no | `json` (the only one for now) | json | `json` | a literal value held by the card, published as its variable |

Types without named sources (`rawvalue`, `jsonassert`) write the type alone
(`source: rawvalue`); the others write `source: {type}/{name}`.

## Cards: `frames/{frame}/step-{n}/{var-file}.md`

Keys, in this order:

| Key | Required | Meaning |
|---|---|---|
| `title` | yes | display name on the canvas (free text) |
| `source` | yes | `{type-source}/{name-source}`, or the type alone (`rawvalue`, `jsonassert`; also allowed for typed cards without a named source yet) |
| `subtype` | when the type has subtypes | one subtype of the type (e.g. `find`); absent otherwise |
| `endpoint` | no | `METHOD /path` for openapi cards: one operation of the source's spec |
| `openapi-id` | no (openapi only) | the operation's `operationId` in the spec: the card's operation identity |
| `timeout` | no | ms (100–120000); default per card type (request/query/js/sql 5000, jsonassert/json 2000, condition 1000) |
| `size` | no | `{width}x{height}`, only when different from the card type default |
| `result-height` | no | px (24–600) of the last-run panel under the card's code |

A `script:` key is invalid (sources have no scripts). Derived, never stored: card id
(`{frame}/step-{n}/{var-file}`), step id/number, var-name, http-method, the card type and the
fence language, all following (type-source, subtype) — see the table above. A card without
`source:`, with an unknown type, a missing/unknown subtype or a name-source on a sourceless
type is rejected on save (400) and reported in `errors` on load.

## Mongo body (`mongo` cards)

One JSON object (fenced as ```` ```json ````); `{{bindings}}` may appear anywhere in it (the
rule checks the body with every binding standing for any value, and checks the resolved
types again at run time). Unknown keys are rejected.

- subtype `find`: `{ "collection": "products", "filter": { "ativo": true } }`, optional
  `projection`, `sort` (objects), `limit`, `skip` (non-negative integers; at most 1000 documents).
- subtype `aggregation`: `{ "collection": "products", "pipeline": [ { "$match": { "ativo": true } } ] }`.

Read-only: write stages (`$out`, `$merge`) are rejected anywhere in the body, before anything
connects. Values are JSON; MongoDB extended JSON (`{"$oid": "..."}`) is understood. The
connection is the `base-url` of the saved `sources/mongo/{name}.md`.

## jsonassert cards

- subtype `script`: one statement per line (`//` lines are comments). `assert <expr> <op> <expr>`
  lines check (a failing assert fails the card and stops the run); plain expressions compute.
  The value of the last plain expression is the card's variable (without one, the last
  assertion's outcome `{passed, actual, expected, operator, jsonata, error}` is). It covers
  checks, filters and mappers: `assert $count(items) > 0` then `items[price > 100].name`.
- subtype `conditional`: exactly one boolean expression (no `assert`), e.g.
  `$count(activeProducts) > 0`, published as the card's variable. `true`: the step goes on;
  `false`: the remaining cards of the current step are skipped (outcome status `skipped`, not an
  error) and the run continues with the next step. A non-boolean result or an evaluation error is
  a card error. Run alone (the editor's Run button) it just shows the boolean.

Both evaluate against every variable published so far in the frame (by var-name), with the
jsonassert Java engine (`$` only prefixes built-in functions; `=` is equality inside
expressions, `==` in assert lines).

## OpenAPI sources and their cache

An `openapi` source's `base-url` is its OpenAPI (or Swagger 2) spec JSON. When the source is
saved, the server reads the spec and writes `sources/openapi/{name}.cache.md`:

````
-------------------
spec-url: http://localhost:18081/api/docs/openapi.json
api-base: http://localhost:18081
fetched-at: 2026-11-22T04:56:41.340Z
-------------------
```json
[ { "operationId" : "create", "method" : "POST", "path" : "/api/products", "summary" : "Criar produto" } ]
```
````

`api-base` is `servers[0].url` (resolved against the spec URL), or the spec URL's origin when
the spec names no server. The cache is the source of truth afterwards: the card editor's
operation select, the endpoint check on load and the runner's URL resolution read it. A
missing cache (or one made from another spec URL) is fetched once and written; a spec that
cannot be read answers 502 (a source save still succeeds and reports it in `warnings`).

An openapi card names its operation by `openapi-id` (the spec's `operationId`, its identity)
plus `endpoint` (its `METHOD /path`). On load, an `openapi-id` missing from the cached spec, or an
`endpoint` that no longer matches that operation's method + path, is a warning in `errors`
(cards without `openapi-id` are checked by `endpoint`). The runner resolves the request by
`openapi-id`, so a card follows its operation when the spec moves the path.

## Step sequence: `flow.md`

Each step folder has a `flow.md` (empty frontmatter) whose body lists the step's card file
names, one per line, in execution order (the `.md` extension may be written or not; the
server always writes it without). Saving a frame rewrites it; the var-name `flow` is
reserved because it would collide with this file. On load, cards missing from the list are
appended (by file name) and entries without a card file are reported in `errors` — the
sequence is never silently lost.

## Sources: `sources/{type-source}/{name-source}.md`

- `{name-source}.md` has one frontmatter key, `base-url`, and no body (any other key or a
  body makes the file invalid: it is skipped and reported in `errors`). For `openapi` it is
  the spec URL, for `mongo` the connection URI (naming the database).
- `{name-source}.private.md` has an empty frontmatter. It is written only when it has content.
- Sources of `rawvalue` and `jsonassert` cannot be saved (those types have no named sources).

## Private data: `*.private.md`

Cards (`{var-file}.private.md`) and sources (`{name-source}.private.md`) keep secrets and access
notes in a sibling file with an empty frontmatter, always gitignored. The IDE edits it in the
card edit modal (cards) and the Sources tab (sources). An absent file means no private data.

## Last run: `{var-file}.cache.md`

After a card runs (whole flow or the card editor's Run, both executed by `POST /api/v2/run*`),
the editor stores its last result next to it: frontmatter `status` (success|error|skipped), `ran-at`, `elapsed`,
`summary`; the body is the output fenced as `json` (or `text` when it does not parse as JSON).
The server adds `*.cache.md` to the project's `testframe/.gitignore`, keeps a result while its
card exists and deletes it with the card. The editor shows it under the card's code and in the
card editor.

## Code rules per (type, subtype)

The rules live in the server (`format/CodeRules`). They are enforced on frame saves (a rejected
frame answers 400 with every problem), checked by the runner before a card runs, and served for
live feedback in the editor (`POST /api/v2/validate` `{sourceType, subtype, code}`, cached per
code; empty code is a draft):

| type / subtype | Accepted code |
|---|---|
| `mongo` / `find`, `aggregation` | the JSON body above |
| `sql` / `oracle` | one `SELECT` statement, `--` comments |
| `jsonassert` / `script` | every non-comment line parses: an `assert <expr> (==\|!=\|>\|>=\|<\|<=) <expr>` line or a jsonassert expression |
| `jsonassert` / `conditional` | exactly one jsonassert expression, without `assert` |

## Execution order

A step is one ordered sequence of cards (no pre/post phases). Cards run in the order their
files are listed in the step's `flow.md`. A request body comes from the nearest `json` card
**before** the card; a request or mongo result is written into the first `json` card **after**
it and published as the card's variable. An openapi request goes to the `api-base` of its
source's cached spec + the operation path (a card without name-source sends relative paths to
the framework server itself).

A `jsonassert` card evaluates against **every variable published so far in the frame**, as an
object keyed by var-name: `assert $count(activeProducts) > 0` reads the `activeProducts`
variable directly. A `conditional` that evaluates to `false` skips the rest of its step (those
cards come back with status `skipped`) and the run continues with the next step; the run stops
at the first `error` card.

## Bindings

`{{varName}}` or `{{varName.path.0.field}}` in a JSON body (rawvalue cards, mongo bodies)
resolves to the value published by an earlier card with that var-name. Var-names are unique
per frame, so a binding is unambiguous.

## API

The API exchanges structured JSON; the server builds every path and file. Full shapes:
`server/AGENTS.md`.

- `GET /api/v2/frames/{project}` → `{frames, errors}`: frames sorted by name, steps renumbered
  from 1 in numeric order, cards in the order of the step's `flow.md`, each with its private
  data and last run. Invalid files are skipped and reported in `errors`, as are openapi
  endpoints missing from their source's cached spec.
- `POST /api/v2/frames` `{project, frame: {name, steps}}`: replaces `frames/{slug(name)}/`;
  other frames are untouched. Steps are numbered by position, card order is stored in each
  step's `flow.md`.
- `POST /api/v2/frames/results` `{project, frame, step, varName, result}`: writes the card's
  `{var-file}.cache.md`.
- `GET /api/v2/sources/{project}` → `{sources: [{typeSource, name, baseUrl, privateData}], errors}`;
  `POST /api/v2/sources` `{project, sources}`: for each sent source, `{type}/{name}.md` and
  `{type}/{name}.private.md` are replaced (openapi sources then rewrite their cache; failures
  come back in `warnings`). Sources that are not sent are untouched.
- `GET /api/v2/sources/openapi/{name}/operations?project=` → `{specUrl, baseUrl, fetchedAt,
  operations: [{operationId, method, path, summary}]}`, read from the cache.
- `POST /api/v2/run` `{project, frame, steps: [{number, cards}]}` and `POST /api/v2/run/card`
  run cards on the server (execution section above): per-card outcomes with status
  `success`, `error` (the run stops there) or `skipped` (after a false conditional).
- `POST /api/v2/run/mongo` `{project, source, subtype, body}`: runs one mongo body.
- Invalid data is rejected with 400 `{status, message}` before anything is written. The store
  still validates every path: it strips `..`, applies a character whitelist, checks that the
  path stays under the projects dir, accepts only `.md` files, and never allows a scope equal
  to the `frames/` or `sources/` root.
- `GET /api/v2/catalog`: the source types with their subtypes (card type, fence language, form
  and default size/timeout per subtype, `hasSources` per type) plus the HTTP methods.
  `POST /api/v2/validate` `{sourceType, subtype, code}`: the code rule (`problem` = null when
  ok). The editor loads the catalog at boot and keeps no local copies of these definitions.

## Example

````
frames/active-products-echo/
  step-1/get-active-products.md  active-products.md  assert-active-products.md
  step-2/product-payload.md  create-product.md  created-product.md  assert-created-product.md
sources/
  mongo/products-db.md  openapi/product-api.md

# frames/active-products-echo/step-1/get-active-products.md
-------------------
title: Get active products
source: mongo/products-db
subtype: find
timeout: 5000
-------------------
```json
{ "collection": "products", "filter": { "ativo": true } }
```

# frames/active-products-echo/step-2/create-product.md
-------------------
title: Create product copy
source: openapi/product-api
subtype: restapi
endpoint: POST /api/products
openapi-id: create
timeout: 8000
size: 360x300
-------------------

# frames/active-products-echo/step-2/created-product.md
-------------------
title: Created product
source: rawvalue
subtype: json
timeout: 2000
-------------------
```json
{ "id": "", "nome": "", "categoria": "", "preco": 0, "ativo": false }
```

# sources/mongo/products-db.md
-------------------
base-url: mongodb://localhost:27017/products
-------------------
````

## Notes

- The client shows one frame at a time: the one named in the header, or the first one on
  disk. Saving writes only that frame.
- The framework server serves the OpenAPI spec of its own in-test targets
  (`/api/v2/openapi.json`: `POST /api/v2/echo`, `GET /api/v2/health`), so an openapi source can
  point at it (the smoke run does).
