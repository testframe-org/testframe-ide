# Project format (`{project}/testframe/`)

How a TestFrame project is stored on disk. Contract owner: the IDE —
`lib/format/` (envelope, naming rules, catalog, card/source codecs, code rules; unit-tested
against the reference project byte for byte) and `lib/store/project-store.ts`
(storage, path sanitization, replace semantics). The execution plugin keeps **read-only** Java
decoders of the same format (`modules/testframe-plugin-spring/.../format/`), held in parity by
`bun run format:check` at the repo root. Clients exchange JSON with the API and never
read or write these files themselves. Reference project: `examples/product-test/testframe/`.

The project is in beta: this format changes without migrations or legacy loaders
(see the root `AGENTS.md`).

Architecture split (root `TODO.md`): the Next.js IDE becomes the owner of this format (read/write,
in TS) and the Spring plugin (`modules/testframe-plugin-spring`) reads it with read-only
decoders and runs it (`docs/runner-protocol.md`, `docs/test-tour.md` at the repo root); it
never writes to the project (test tours live in the browser and are not stored). Both implement this document. Validation and canonical formatting of
every file (the `.md` files and the `sources*.yaml` layers) belong to the IDE; the plugin's Java
decoders read the same files read-only (the YAML layers with a safe YAML 1.2 loader).

## Principles

1. **The path is the identity.** Frame, step number and card variable are read from the path
   only (a source's identity is its `{type}` → `{name}` key in `sources.yaml`). Frontmatter never repeats them, so renaming a file or folder
   cannot leave it contradicting its own frontmatter.
2. **Frontmatter stores only what the path cannot express**, and omits values equal to
   their defaults (`size`) or empty (`endpoint`). It may be empty.
3. **One envelope for every file:** a `-------------------` line, `key: value` lines and a
   closing `-------------------` line, then the body. A card's body is a single fenced
   Markdown block tagged with the language of its (type-source, subtype) (mongo: one
   ```` ```json ```` array of call arguments).
4. **Every card declares its type-source** (`source:`), and its **subtype** when the type has
   subtypes. A card always holds its own code: sources have no scripts.
5. **A source is only its connection,** declared in `sources.yaml` (type → name → fields) and
   refined per environment by layered YAML files; secrets live only in `.private.yaml` layers.
6. **Saving replaces.** Saving a frame replaces its whole directory, and saving the sources
   rewrites the layer files. Removed cards and sources do not linger on disk.
7. **Private data sits next to what it belongs to:** `{var-file}.private.md` (card notes) and
   `sources[.{env}].private.yaml` (source credentials), always gitignored. There are no
   versioned templates.
8. **Generated files are never project format:** the IDE's build cache (`.testframebuild/`:
   cards' last runs, openapi operations) is gitignored and safe to delete; `frames/` and the
   `sources*.yaml` layers hold only authored files. `testframe/.gitignore` (written by the IDE)
   holds `*.private.md`,
   `*.private.yaml` and `.testframebuild/`.
9. **Every run has an environment.** There is no environment-less run: the editor, the tour and
   the CLI always run in one environment of the `environments` list, and a card whose source is
   not configured for it fails.

## Layout

```
{project}/testframe/
  .gitignore                       *.private.md, *.private.yaml, .testframebuild/ (written by the IDE)
  .testframebuild/                 the IDE's generated build cache: last runs, openapi operations (reserved name; layout private to the IDE; safe to delete)
  sources.yaml                     environments list + every source: type → name → fields (committed)
  sources.private.yaml             credentials common to every environment (optional, gitignored)
  sources.{env}.yaml               overrides for one environment (optional, committed)
  sources.{env}.private.yaml       credentials / overrides for one environment (optional, gitignored)
  frames/
    {frame}/                       one flow (canvas), kebab-case, e.g. active-products-echo
      step-{n}/                    step number n (1-based, ordered numerically)
        flow.md                    the step's card sequence: one card file name per line, in order
        {var-file}.md              one card; var-name = camelCase(var-file)
        {var-file}.private.md      optional private data of that card (gitignored)
```

The names convert both ways: `getActiveProducts` ↔ `get-active-products.md`. Var-names
must be camelCase with no consecutive capitals (`getHttpData`, not `getHTTPData`), or the
round trip would lose information. The card editor normalizes input, and the server rejects
(400) var-names that do not survive the round trip and duplicate var-names within a frame,
because var-names are the binding identity. Source names match `[a-z0-9][a-z0-9_-]*` (at
least 2 characters). Environment names are kebab-case, `[a-z0-9]+(-[a-z0-9]+)*`, and `private`
is reserved, so `sources.{a}.yaml` and `sources.{a}.private.yaml` always parse unambiguously.
The name `.testframebuild` is reserved at the `testframe/` root. Frame names are kebab-case.

**File size.** A project file (card, `flow.md`, `.private.md`, `sources*.yaml` layer) is at most
2 MiB (2 097 152 bytes, UTF-8). A larger file found on disk is never read: it is reported in
`errors` as `{path}: larger than 2097152 bytes, not read` (the IDE and the plugin decoders apply
the same limit). The IDE never writes one: a save that would produce a larger file is rejected
with 400 (`{path}: larger than 2097152 bytes, not written`) before any file of that save is
written.

## Source types and subtypes

Every source has a TYPE; a card bound to it picks a SUBTYPE of that type. The table lives in
the server catalog (`format/Catalog`, served by `GET /api/v2/catalog`); the editor keeps no copy.

| type | named sources | subtypes (card-level) | card type | fence | notes |
|---|---|---|---|---|---|
| `openapi` | yes | `restapi`, `swagger`, `graphql` | request | `js` (`json` for swagger) | `base-url` is the OpenAPI spec JSON; cards pick one of its operations |
| `mongo` | yes | `find`, `aggregation`, `deleteOne`, `deleteMany`, `updateOne`, `updateMany`, `insertOne`, `insertMany` | query | `json` | body is one JSON array: the call's positional arguments (see below) |
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
| `collection` | mongo cards only (required) | the collection the call works on: non-empty, no `$`, no spaces around, no null character, not `system.*` |
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

## Mongo cards

The collection is frontmatter (`collection: products`, required), like an openapi card's
`endpoint`; the subtype names the driver function. The body is one ```` ```json ```` block
holding a JSON **array whose items are the function's positional arguments**, like the shell
call `db.products.find(<arg1>, <arg2>, <arg3>)`. Trailing optional arguments may be omitted, and
`null` skips an optional argument (`[{ "ativo": true }, null, { "limit": 5 }]`). On the wire
(the card's `code`) it is the same array text. An empty body is a draft (`find` runs it as `[]`;
the other subtypes report their missing required argument).

| subtype | arguments | options (last argument, an object) |
|---|---|---|
| `find` | `[filter, projection?, options?]` | `sort` (object), `limit`, `skip`, `maxTimeMS` (integers ≥ 0), `collation`, `hint`, `comment` |
| `aggregation` | `[pipeline, options?]` | `allowDiskUse` (boolean), `maxTimeMS`, `batchSize` (integer ≥ 1), `collation`, `hint`, `comment`, `let` (object) |
| `deleteOne`, `deleteMany` | `[filter, options?]` | `collation`, `hint`, `comment`, `let` |
| `updateOne`, `updateMany` | `[filter, update, options?]` | `upsert` (boolean), `arrayFilters` (array of objects), `collation`, `hint`, `comment`, `let` |
| `insertOne` | `[document, options?]` | `comment`, `bypassDocumentValidation` (boolean) |
| `insertMany` | `[documents, options?]` | `ordered` (boolean), `comment`, `bypassDocumentValidation` |

`filter`, `projection`: objects. `pipeline`: a non-empty array of stage objects. `update`: an
object of `$`-operators only (`{"$set": {...}}`; a plain key would replace the document) or an
update pipeline (array of stages). `document`: a non-empty object without top-level `$` keys;
`documents`: a non-empty array of those. `hint`: an index name (string) or a key object.
`collation` takes the driver's keys: `locale` (required), `caseLevel`, `caseFirst`, `strength`,
`numericOrdering`, `alternate`, `maxVariable`, `normalization`, `backwards`.

Guards (validation errors, checked before anything connects): more arguments than the subtype
takes; a missing required argument; a wrong argument type; an unknown option key; an empty
filter on a delete or update (it would hit the whole collection); a non-operator update;
`$out`/`$merge` anywhere in the body. Problems name the argument:
`arg 3 (options): unknown key "foo"`.

Saving stores the canonical text: one argument per line, each printed compactly, keys, strings,
numbers and bindings kept as written, so a second save of unchanged content is byte-identical.
A draft that is not a well-formed array is stored as written (the code rule reports why).

````
-------------------
title: Cheap products
source: mongo/products-db
subtype: find
collection: products
-------------------
```json
[
  { "ativo": true, "preco": { "$lt": 100 } },
  { "nome": 1, "preco": 1 },
  { "sort": { "preco": 1 }, "limit": 10 }
]
```
````

`{{bindings}}` go inside strings: a string that is exactly one binding becomes the bound value
with its JSON type (`{ "_id": "{{createdProduct.id}}" }`), a binding inside longer text is
replaced inline. The code rule checks the body with every binding standing for any value, and
the runner checks the resolved arguments again. Values are JSON; MongoDB extended JSON
(`{"$oid": "..."}`) is understood, and field references keep MongoDB's `$field` syntax.

Execution: `maxTime` is the card timeout, or `maxTimeMS` when lower and not 0. Reads
(`find`, `aggregation`) return at most 1000 documents; writes return their counts
(`deletedCount`; `matchedCount`, `modifiedCount`, `upsertedId`; `insertedId`; `insertedIds`,
`insertedCount`). ObjectIds come out as hex strings. The result is
`{operation, collection, count, result}`, and `result` is published as the card's variable. The
connection is the source's resolved `base-url` in the run's environment (see "Sources").

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

## OpenAPI sources and their operations

An `openapi` source's resolved `base-url` is its OpenAPI (or Swagger 2) spec JSON, fetched with
the source's resolved `headers`. An operation is `{operationId, method, path, summary}`; the
source's `api-base` is `servers[0].url` (resolved against the spec URL), or the spec URL's origin
when the spec names no server.

The IDE keeps a per-environment cache of each openapi source's operations, keyed by the SHA-256
of the resolved spec URL (the URL itself is never stored: a private layer may have set it), under
`testframe/.testframebuild/`. Its layout and format are an implementation detail
of the IDE, not part of this format: the IDE may rebuild it at any time, nothing else reads it,
and deleting `.testframebuild/` is always safe. A spec that cannot be read answers 502 (a sources
save still succeeds and reports it in `warnings`); the message names the spec URL only when no
private layer set it, and the source's secrets are redacted from it. The spec is fetched without
following redirects, so the source's private headers never reach another host. The `api-base`
never carries the spec URL's user-info. A run request carries the `api-base` and the
operations of the run's environment (`docs/runner-protocol.md`); the card editor's operation
select and the endpoint check on load use the current environment's operations. The plugin
never reads `.testframebuild/`: for a tour run it fetches each openapi spec it needs once per
run, in memory.

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

A step with no cards is valid and is stored as its `step-{n}/` folder holding an empty `flow.md`
(envelope only, no entries); saving always writes a `flow.md` for every step, and loading a
`flow.md` with no entries yields an empty step.

## Sources: `sources.yaml` and its layers

All sources of a project live in YAML files at the `testframe/` root. YAML is restricted to
maps, the `environments` list and string scalars (no anchors, aliases, tags or multi-documents);
anything else is a validation error.

```yaml
# sources.yaml (committed)
environments: [local, dev, hml, prd]
openapi:
  product-api:
    base-url: http://product-api-{env}.dev/v3/api-docs
    headers:
      x-tenant: testframe
mongo:
  products-db:
    base-url: mongodb://mongo-{env}.dev:27017/products

# sources.local.yaml (committed)
openapi:
  product-api:
    base-url: http://localhost:18081/api/docs/openapi.json
mongo:
  products-db:
    base-url: mongodb://localhost:27017/products

# sources.hml.private.yaml (gitignored)
openapi:
  product-api:
    headers:
      Authorization: Bearer eyJhbGciOi...
mongo:
  products-db:
    base-url: mongodb://app:s3cret@mongo-hml.dev:27017/products
```

**Files** (only `sources.yaml` is required):

| File | Git | Holds |
|---|---|---|
| `sources.yaml` | committed | `environments` (the official list) and every source declaration with its base fields |
| `sources.private.yaml` | ignored | credentials common to every environment |
| `sources.{env}.yaml` | committed | overrides for `{env}` |
| `sources.{env}.private.yaml` | ignored | credentials / overrides for `{env}` |

**Structure.** Top-level keys: `environments` (only in `sources.yaml`: a non-empty list of
unique environment names) and source types with named sources (`openapi`, `mongo`, `sql`,
`kafka`, `grpc`). Under a type, source names; under a source, its fields. A source may be
declared with no fields (`products-db: {}`) and get them from the layers.

| type | fields |
|---|---|
| `openapi` | `base-url` (the spec URL), `headers` (map: header name → value) |
| `mongo` | `base-url` (connection URI naming the database) |
| `sql`, `kafka`, `grpc` | `base-url` |

**Validation** (the IDE refuses to save, both sides report in `errors`): unknown top-level key,
type, or field; a non-string field value; header names not matching `[A-Za-z0-9-]+`, or repeated
within one map ignoring case; `environments` missing, empty, with duplicates or invalid names,
or present in a layer other than `sources.yaml`; a layer naming a type or source not declared in
`sources.yaml`; a `sources.{x}[.private].yaml` file whose `{x}` is not in `environments`; any other
`sources.*.yaml` file name.
A project with invalid source files cannot run (the IDE shows the errors; a tour run answers
400, the CLI exits 2).

**Resolution** of the sources for a run in environment `E`:

1. Merge the layers, last wins: `sources.yaml` ← `sources.private.yaml` ← `sources.E.yaml` ←
   `sources.E.private.yaml`. Maps merge key by key (deep), scalars replace. `headers` merge
   header by header, names compared case-insensitively and emitted lower-case. A `null` value
   in a layer removes that field or header.
2. Substitute `{env}` with `E` in `base-url` and in every header value (only the exact token
   `{env}`; other braces are left as written).
3. A source is **configured for `E`** when its resolved `base-url` is non-empty. A card bound to
   a source that is not configured is a card error (`source mongo/products-db has no base-url in
   environment hml`); the tour start screen and the CLI flag such sources before running.

Every resolved value whose winning layer is a `.private.yaml` file is a **secret**: it is sent to
the plugin in the request's `secrets` and redacted by the plugin from results, run events and logs, so the tour report never sees it
(`docs/runner-protocol.md`, "Security"; `docs/test-tour.md`, "Redaction").

**Saving.** The IDE owns these files and writes them in canonical form: two-space indentation;
in `sources.yaml` `environments` first as a flow list; types in catalog order (`openapi`, `mongo`,
`sql`, `kafka`, `grpc`); sources by name; fields `base-url` then `headers`; headers by name;
values quoted only when YAML needs it. Saving the sources rewrites `sources.yaml`,
`sources.private.yaml` and the `sources.{env}.yaml` / `sources.{env}.private.yaml` of every
environment in the list, deletes those that end up empty, and deletes every layer of an
environment removed from the list. Removing or renaming a source removes it from every layer;
the IDE drops their cached operations. The IDE's Sources tab lists sources by type with an
environment selector: "all environments" edits `sources.yaml` / `sources.private.yaml`, an
environment edits its overrides and credentials; the editor keeps a current environment for its
runs.

Cards reference a source as `source: {type}/{name}` (e.g. `source: openapi/product-api`); a
name not declared in `sources.yaml` is reported on load and is a card error at run time.
`rawvalue` and `jsonassert` have no named sources.

## Private data

Always gitignored; an absent file means no private data.

- Cards: `{var-file}.private.md`, empty frontmatter, free notes in the body. Notes only: never
  execution input, never sent to the plugin. The IDE edits it in the card edit modal.
- Sources: `sources.private.yaml` and `sources.{env}.private.yaml`, execution input only (see
  "Sources"); there are no source notes.

## Last run

After a card runs from the editor (whole flow or the card editor's Run), the IDE keeps its last
result (status `success`|`error`|`skipped`, ran-at, elapsed, summary, output) per environment in
`.testframebuild/`, and shows it under the card's code and in the card editor. The storage layout
is internal to the IDE (not part of this format); results of deleted cards are dropped, and
deleting `.testframebuild/` only loses the last runs. Test tours are not stored in the project
(`docs/test-tour.md`).

## Code rules per (type, subtype)

The rules live in the server (`format/CodeRules`). They are enforced on frame saves (a rejected
frame answers 400 with every problem), checked by the runner before a card runs, and served for
live feedback in the editor (`POST /api/v2/validate` `{sourceType, subtype, code}`, cached per
code; empty code is a draft):

| type / subtype | Accepted code |
|---|---|
| `mongo` / every subtype | the JSON array of arguments above (one problem per argument) |
| `sql` / `oracle` | one `SELECT` statement, `--` comments |
| `jsonassert` / `script` | every non-comment line parses: an `assert <expr> (==\|!=\|>\|>=\|<\|<=) <expr>` line or a jsonassert expression |
| `jsonassert` / `conditional` | exactly one jsonassert expression, without `assert` |

## Execution order

A step is one ordered sequence of cards (no pre/post phases). Cards run in the order their
files are listed in the step's `flow.md`. A request body comes from the nearest `json` card
**before** the card; a request or mongo result is written into the first `json` card **after**
it and published as the card's variable. An openapi request goes to the `api-base` of its
source's spec in the run's environment + the operation path; an absolute endpoint
(`GET https://...`) is sent as is, and a relative one without name-source is a card error.

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

The API exchanges structured JSON; the IDE builds every path and file. Full shapes:
this module's `AGENTS.md`.

- `GET /api/v2/frames/{project}` → `{frames, errors}`: frames sorted by name, steps renumbered
  from 1 in numeric order, cards in the order of the step's `flow.md`, each with its private
  data and last run. Invalid files are skipped and reported in `errors`, as are openapi
  endpoints missing from their source's cached spec.
- `POST /api/v2/frames` `{project, frame: {name, steps}}`: replaces `frames/{slug(name)}/`;
  other frames are untouched. Steps are numbered by position, card order is stored in each
  step's `flow.md`.
- `POST /api/v2/results` `{project, environment, frame, step, varName, result}`: stores the card's
  last run in `.testframebuild/`.
- `GET /api/v2/sources/{project}` → `{environments, layers: {base, private, env: {E: {public,
  private}}}, errors}`: every layer as JSON (same structure as its YAML), except that **private
  values never leave the IDE**: every string value of a `.private.yaml` layer (`base-url`, each
  header value) comes back as the marker string `"<private>"` (a `null` removal stays `null`;
  names and structure are kept, so the editor knows which fields are private).
  `POST /api/v2/sources` `{project, environments, layers}`: rewrites the layer files as in
  "Sources" (then refreshes the current environment's openapi cache; failures come back in
  `warnings`, with secrets redacted). A field still holding `"<private>"` keeps the value stored
  on disk at the same place — same private layer file, type, source and field (header names
  ignore case); a new value replaces it; a field left out removes it. A marker in a shared layer,
  or one with no stored value at that place (e.g. after a rename), is a 400: a stored secret is
  never copied to another layer or source, so it has to be typed again. The editor shows private
  fields write-only (empty password inputs saying a value is stored).
- `GET /api/v2/sources/openapi/{name}/operations?project=&env=` → `{baseUrl, fetchedAt,
  operations: [{operationId, method, path, summary}]}`, read from that environment's cache (the
  spec URL is not returned: it is the source's base-url, possibly private).
- Every run takes the environment (`env`); the editor keeps a current-environment selector.
- `POST /api/v2/run` `{project, frame, steps: [{number, cards}]}` and `POST /api/v2/run/card`
  run cards on the server (execution section above): per-card outcomes with status
  `success`, `error` (the run stops there) or `skipped` (after a false conditional).
- `POST /api/v2/run/mongo` `{project, source, subtype, collection, body}`: runs one mongo call
  (`body` = the JSON array of arguments).
- Invalid data is rejected with 400 `{status, message}` before anything is written; a body that
  is not `application/json` is a 415. The IDE listens on `127.0.0.1` only, answers only requests
  addressed to a loopback host name (`localhost`, `127.0.0.1`, `[::1]`; 403 otherwise), and
  refuses with 403 a state-changing request (any method but GET/HEAD/OPTIONS, the `/api/tour/*`
  proxy included) whose `Sec-Fetch-Site` is not `same-origin`/`none` or whose `Origin` is not
  its own. The tour proxy forwards only paths made of `[A-Za-z0-9._-]+` segments (never `.`,
  `..` or empty, in any encoding) under the plugin's `/api/v1/tour`. The store
  still validates every path: it strips `..`, applies a character whitelist, checks that the
  path stays under the projects dir, accepts only `.md` files (plus the `sources*.yaml` layers at
  the `testframe/` root), and never allows a scope equal to the `frames/` root.
- `GET /api/v2/catalog`: the source types with their subtypes (card type, fence language, form
  and default size/timeout per subtype, `hasSources` per type) plus the HTTP methods.
  `POST /api/v2/validate` `{sourceType, subtype, code}`: the code rule (`problem` = null when
  ok). The editor loads the catalog at boot and keeps no local copies of these definitions.

## Example

````
frames/active-products-echo/
  step-1/get-active-products.md  active-products.md  assert-active-products.md
  step-2/product-payload.md  create-product.md  created-product.md  assert-created-product.md
sources.yaml

# frames/active-products-echo/step-1/get-active-products.md
-------------------
title: Get active products
source: mongo/products-db
subtype: find
collection: products
timeout: 5000
-------------------
```json
[
  { "ativo": true }
]
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

# sources.yaml
environments: [local]
openapi:
  product-api:
    base-url: http://localhost:18081/api/docs/openapi.json
mongo:
  products-db:
    base-url: mongodb://localhost:27017/products
````

## Notes

- The editor shows one frame at a time: the one named in the header, or the first one on
  disk. Saving writes only that frame.
