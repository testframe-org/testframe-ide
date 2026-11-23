# Storage format design: what `testframe/` should look like on disk

Status: **accepted — Option B, with the defaults of §7 (Q1–Q8)** (journal 2026-11-22 #120, #127).
Not implemented yet: it lands after the architecture split is committed. Until then the canonical
spec stays `docs/project-format.md`; the implementation moves this content into that spec and
deletes this file (a fact lives in one place).

Reference project: `examples/product-test/testframe/` (one frame, `active-products-echo`, 2 steps,
7 cards, 2 sources). Every on-disk example below is converted from those real files.

## 1. Problem framing

The question was "what would be the best format to store the data here, and what would it look
like", pointing at `examples/product-test/testframe/**`. "Data" has two readings:

| Reading | What it covers | Where it lives today |
|---|---|---|
| **(a) the project files** | frames, steps, cards and their code, the card order, sources, environments, private data | `frames/{frame}/step-{n}/{var-file}.md` + `flow.md` per step + `{var-file}.private.md`; `sources*.yaml` layers |
| **(b) the test data ("massa de dados")** | the `rawvalue` input values a tour lets the user edit; the data the cards produce | inputs = the code of the input `rawvalue` cards; tour edits stay in the browser (#48, #49, #69); produced data is never stored in the project (last runs in `.testframebuild/`, #66–#67; evidence only in the downloaded PDF, #69) |

**Most likely meaning: (a).** The path given is the project folder itself, and the visible
pain is there: one frame of 7 cards is 9 files in 2 folders, the card order lives in a second
file (`flow.md`) that can disagree with the folder, and every file uses a home-made envelope
(`-------------------`) that both the IDE (TS) and the plugin (Java) parse by hand. Reading (b)
is answered in §6, consistently with the recommendation.

### Already decided (not reopened here)

- Sources: one `sources.yaml` with `environments` + layers `sources.private.yaml`,
  `sources.{env}.yaml`, `sources.{env}.private.yaml`, the `{env}` placeholder (#61–#64). This
  design keeps them exactly as they are.
- Generated data (openapi operations, cards' last runs) lives in `.testframebuild/`, internal
  format, gitignored (#66, #67).
- No tours on disk: the tour runs, collects evidence in memory/browser and downloads a PDF (#69).
- The plugin never writes to the project; the IDE owns the format; both parse it and
  `bun run format:check` keeps them identical (root `AGENTS.md`).
- 2 MiB per project file, refused on save, skipped and reported on load (#105, #115); secrets are
  masked by the IDE API and redacted by the plugin (#115).
- A card always holds its own code; a source is only its connection (2026-11-21 journal, #19–#22).
- Beta: no migrations, no legacy loaders. A format change updates every consumer and
  regenerates the examples.

## 2. Evaluation criteria (concrete for testframe)

| # | Criterion | What "good" means here |
|---|---|---|
| C1 | **Git diffs and merges** | Changing one card touches a few lines; two people editing different cards of the same frame merge cleanly; reordering is a small diff |
| C2 | **Hand-editing / reading outside the IDE** | A reviewer on GitHub or in a plain editor understands a frame and can fix a card without the IDE |
| C3 | **One identity, stated once** | Frame, step, var-name and order each live in exactly one place, so nothing can contradict anything (today's "the path is the identity" rule) |
| C4 | **Code without escaping** | JSON, mongo argument arrays, jsonassert, SQL and JS stored verbatim: no `\"`, no `\n` |
| C5 | **Secrets apart** | Private data in separate, gitignored files, never mixed into a committed file |
| C6 | **Parsed twice cheaply** | Few hand-written parsers; the TS owner and the Java reader share a well-defined grammar so `format:check` parity is easy to hold |
| C7 | **Save semantics** | "Saving replaces" is simple and, ideally, atomic; few files per save |
| C8 | **Size cap** | Fits the 2 MiB per-file cap with realistic frames and fixtures |
| C9 | **Future needs** | Room for data sets / run N times / generators (split plan §8, `TODO.md` "Later"), `web` cards, SQL execution (autocomplete plan E1) without another layout change |

### Problems of the current layout, measured against them

- **Order lives twice (C3).** The folder holds the cards, `flow.md` holds their order. The
  loader must handle "listed but missing", "listed twice" and "not listed" (`frame-codec.ts`
  `orderStep`, `FrameDecoder.java`) — three error cases that exist only because of the split.
- **The var-name is encoded in a file name (C3).** `getActiveProducts` ↔ `get-active-products.md`
  forces the "no consecutive capitals" rule (`getHTTPData` cannot be stored) and reserves the
  var-name `flow`.
- **A home-made envelope (C6).** `-------------------` + `key: value` is neither Markdown
  frontmatter (`---`) nor YAML: `MdEnvelope` exists twice (TS, Java) with its own line regex,
  and editors/GitHub do not recognise it.
- **Non-atomic save (C7).** Saving a frame writes N files then deletes stale ones
  (`project-store.ts` `replace`); a crash in between leaves a mixed frame.
- **Defaults written anyway (C1).** Principle 2 of the spec says frontmatter omits defaults, but
  `card-codec.ts` `render` always writes `timeout` (`card.timeout ?? defaultTimeout(type)`), so
  6 of 7 example cards carry a default `timeout`. `rawvalue` cards also write `subtype: json`,
  the only subtype that type has.
- **Conflict hotspot (C1).** Two people adding a card to the same step both append a line to
  `flow.md` — a conflict whatever the card files look like.

### Field-level cleanups common to every option

So the options below differ only in layout, they all apply the same two cleanups:

1. Omit `timeout` when it equals the card type's default (request/query/js/sql 5000,
   jsonassert/json 2000, condition 1000), as principle 2 already says.
2. Omit `subtype` when the type has exactly one subtype (`rawvalue` → `json`); the catalog
   supplies it on load.

## 3. Options

### Option A — keep one Markdown file per card, with standard frontmatter

Same tree as today. Changes: the envelope becomes standard `---` YAML frontmatter, read with the
restricted YAML loader both sides already have (`lib/sources/sources-yaml.ts` → `yaml`,
`format/SafeYaml.java`); `flow.md` keeps its role but drops the empty envelope.

```
testframe/
  .gitignore
  sources.yaml
  frames/active-products-echo/
    step-1/
      flow.md
      get-active-products.md
      active-products.md
      assert-active-products.md
    step-2/
      flow.md
      product-payload.md
      create-product.md
      created-product.md
      assert-created-product.md
```

`frames/active-products-echo/step-1/flow.md`

```
get-active-products
active-products
assert-active-products
```

`frames/active-products-echo/step-1/get-active-products.md`

````
---
title: Get active products
source: mongo/products-db
subtype: find
collection: products
---
```json
[
  { "ativo": true }
]
```
````

`frames/active-products-echo/step-1/active-products.md`

````
---
title: Active products
source: rawvalue
---
```json
[
  { "id": "1", "nome": "Kit Testes E2E", "categoria": "Ferramentas", "preco": 480 },
  { "id": "2", "nome": "Licenca TestFrame", "categoria": "Software", "preco": 1290 }
]
```
````

`frames/active-products-echo/step-1/assert-active-products.md`

````
---
title: Assert active products
source: jsonassert
subtype: script
---
```jsonassert
assert $count(activeProducts) > 0
```
````

`frames/active-products-echo/step-2/flow.md`

```
product-payload
create-product
created-product
assert-created-product
```

`frames/active-products-echo/step-2/product-payload.md`

````
---
title: Product payload
source: rawvalue
---
```json
{
  "nome": "{{getActiveProducts.0.nome}} (copy)",
  "categoria": "{{getActiveProducts.0.categoria}}",
  "preco": "{{getActiveProducts.0.preco}}",
  "ativo": false
}
```
````

`frames/active-products-echo/step-2/create-product.md`

```
---
title: Create product copy
source: openapi/product-api
subtype: restapi
endpoint: POST /api/products
openapi-id: create
timeout: 8000
size: 360x300
---
```

`frames/active-products-echo/step-2/created-product.md`

````
---
title: Created product
source: rawvalue
---
```json
{ "id": "", "nome": "", "categoria": "", "preco": 0, "ativo": false }
```
````

`frames/active-products-echo/step-2/assert-created-product.md`

````
---
title: Assert created product
source: jsonassert
subtype: script
---
```jsonassert
assert createdProduct.categoria == getActiveProducts[0].categoria
```
````

`sources.yaml` and `.gitignore`: unchanged.

**Trade-offs**

| | |
|---|---|
| C1 | Per-card diffs and per-card `git log`; but `flow.md` stays a conflict hotspot and a reorder touches `flow.md` only (good) |
| C2 | Best on GitHub: frontmatter rendered as a table, code highlighted by its fence |
| C3 | Unchanged problems: order in `flow.md` vs files; var-name in a file name (round-trip rule, `flow` reserved) |
| C4 | Fenced code, verbatim (the fence grows past any backtick run in the code) |
| C5 | `{var-file}.private.md` beside the card, as today |
| C6 | Removes the custom key/value parser (frontmatter goes through the YAML loaders), keeps fence handling, the `flow.md` reconciliation and the file-name conversion — twice |
| C7 | Directory replace, multi-file, not atomic (as today) |
| C8 | Per card: never a concern |
| C9 | Data sets need yet another file kind (per frame or per card) |

Cost: small (envelope only). It fixes the cosmetic problem and none of the structural ones.

### Option B — one YAML file per frame (recommended)

A frame is one file: `frames/{frame}.yaml`. Top-level keys `step-1`, `step-2`, … (the same
names the folders have today) each hold the step's cards as a list, in execution order; a card
is a map whose `var` is its var-name and whose `code` is a literal block scalar (`|-`). The
order is the list order — there is no `flow.md`.

```
testframe/
  .gitignore
  sources.yaml
  frames/
    active-products-echo.yaml
```

`frames/active-products-echo.yaml`

```yaml
step-1:
  - var: getActiveProducts
    title: Get active products
    source: mongo/products-db
    subtype: find
    collection: products
    code: |-
      [
        { "ativo": true }
      ]
  - var: activeProducts
    title: Active products
    source: rawvalue
    code: |-
      [
        { "id": "1", "nome": "Kit Testes E2E", "categoria": "Ferramentas", "preco": 480 },
        { "id": "2", "nome": "Licenca TestFrame", "categoria": "Software", "preco": 1290 }
      ]
  - var: assertActiveProducts
    title: Assert active products
    source: jsonassert
    subtype: script
    code: |-
      assert $count(activeProducts) > 0
step-2:
  - var: productPayload
    title: Product payload
    source: rawvalue
    code: |-
      {
        "nome": "{{getActiveProducts.0.nome}} (copy)",
        "categoria": "{{getActiveProducts.0.categoria}}",
        "preco": "{{getActiveProducts.0.preco}}",
        "ativo": false
      }
  - var: createProduct
    title: Create product copy
    source: openapi/product-api
    subtype: restapi
    endpoint: POST /api/products
    openapi-id: create
    timeout: 8000
    size: 360x300
  - var: createdProduct
    title: Created product
    source: rawvalue
    code: |-
      { "id": "", "nome": "", "categoria": "", "preco": 0, "ativo": false }
  - var: assertCreatedProduct
    title: Assert created product
    source: jsonassert
    subtype: script
    code: |-
      assert createdProduct.categoria == getActiveProducts[0].categoria
```

Private notes of a frame (the example has none; shape only):
`frames/active-products-echo.private.yaml`, a map var-name → notes text.

```yaml
createProduct: |-
  {notes for this card, gitignored, never sent to the plugin}
```

`.gitignore` (written by the IDE) loses `*.private.md`:

```
# Written by the TestFrame IDE: private data and the IDE build cache are never versioned
*.private.yaml
.testframebuild/
```

`sources.yaml`: unchanged.

**Trade-offs**

| | |
|---|---|
| C1 | Edits to different cards are different hunks and merge cleanly; edits to adjacent lines (e.g. two cards appended at the end of the same step) conflict — exactly the case that already conflicts today in `flow.md`. A reorder shows as a moved block instead of a moved line. History is per frame (`git log -L` for one card) |
| C2 | The whole frame reads top to bottom in one screen, in run order, which is how the canvas shows it. Code inside a block scalar is plain text to most highlighters, and hand-editing it means keeping its indentation |
| C3 | Best: frame = file name, step = key, var-name = `var`, order = list position; each stated once, nothing to reconcile. The var-name no longer passes through a file name, so the round-trip rule and the reserved `flow` name go away |
| C4 | Literal block scalars are verbatim (no escaping); the writer always uses `\|-`, even for one line, so a diff never flips between styles |
| C5 | `{frame}.private.yaml`, gitignored by the existing `*.private.yaml` pattern — the same convention as `sources*.private.yaml` |
| C6 | Best: one generic, already-present YAML loader per side (`yaml` / `SafeYaml`, already restricted: no anchors, aliases, tags, multi-docs). Deleted twice: the envelope parser, the fence handling, the `flow.md` reconciliation, the step-folder walk. Only the TS side writes, so the canonical emitter exists once; parity is a read-only concern |
| C7 | Saving a frame writes one file atomically (`writeAtomic`: temp file + rename, already in the store) plus, when there are notes, its `.private.yaml`; nothing to delete except a stale `.private.yaml` |
| C8 | The 2 MiB cap now applies to the whole frame. Fine for authored cards; a frame embedding large JSON fixtures could reach it (see Q6) |
| C9 | Frame-level keys sit beside `step-{n}`: a future `data:` (data sets, §6) or `repeat:` needs no new file kind |

Rules the spec would state for B:

- `frames/` holds only `{frame}.yaml` and `{frame}.private.yaml`, flat (frame names kebab-case,
  as today). Anything else under `frames/` is reported in `errors`.
- Top level: `step-{n}` keys (n ≥ 1, numeric order, renumbered from 1 on load as today), each a
  list of cards; an empty step is `step-2: []`. Unknown top-level keys are errors.
- Card keys, in this order: `var`, `title`, `source`, `subtype`, `collection`, `endpoint`,
  `openapi-id`, `timeout`, `size`, `result-height`, `code`. Same meaning and validation as the
  current frontmatter (spec "Cards"); `var` unique per frame.
- Types: text fields must be string scalars, `timeout`/`result-height` integer scalars (YAML 1.2
  core schema, as `SafeYaml` already types them). The writer quotes a string only when YAML would
  read it as something else (`title: "2024"`), so `title: true` written by hand is an error, not
  a boolean title — the same rule `sources.yaml` has ("a non-string field value").
- `code` is always written as `|-` (no trailing newline, matching today's
  `stripTrailingNewlines`); a code whose first line starts with spaces gets an indentation
  indicator (`|2-`), which the `yaml` library emits on its own. Empty code: the key is omitted.
- Mongo code keeps its canonical form (one argument per line, `mongo-json.ts`) inside the scalar.

Considered and rejected as a variant of B: **one Markdown file per frame** (`## step-1`,
`### getActiveProducts`, a key/value block and a fenced block per card). It renders nicely on
GitHub but needs a hand-written structural Markdown parser on both sides — the opposite of C6.

### Option C — a directory per frame: a manifest plus native code files

`frames/{frame}/frame.yaml` holds the steps, the order and every card's metadata (Option B
without `code`); each card's code is a file named after its var-file with the extension of its
fence language. Steps are no longer folders (the manifest says which step a card is in).

```
testframe/
  .gitignore
  sources.yaml
  frames/active-products-echo/
    frame.yaml
    get-active-products.json
    active-products.json
    assert-active-products.jsonassert
    product-payload.json
    created-product.json
    assert-created-product.jsonassert
```

`create-product` has no file: an openapi card's body comes from the `json` card before it, so its
code is empty.

`frames/active-products-echo/frame.yaml`

```yaml
step-1:
  - var: getActiveProducts
    title: Get active products
    source: mongo/products-db
    subtype: find
    collection: products
  - var: activeProducts
    title: Active products
    source: rawvalue
  - var: assertActiveProducts
    title: Assert active products
    source: jsonassert
    subtype: script
step-2:
  - var: productPayload
    title: Product payload
    source: rawvalue
  - var: createProduct
    title: Create product copy
    source: openapi/product-api
    subtype: restapi
    endpoint: POST /api/products
    openapi-id: create
    timeout: 8000
    size: 360x300
  - var: createdProduct
    title: Created product
    source: rawvalue
  - var: assertCreatedProduct
    title: Assert created product
    source: jsonassert
    subtype: script
```

`frames/active-products-echo/get-active-products.json`

```json
[
  { "ativo": true }
]
```

`frames/active-products-echo/active-products.json`

```json
[
  { "id": "1", "nome": "Kit Testes E2E", "categoria": "Ferramentas", "preco": 480 },
  { "id": "2", "nome": "Licenca TestFrame", "categoria": "Software", "preco": 1290 }
]
```

`frames/active-products-echo/assert-active-products.jsonassert`

```
assert $count(activeProducts) > 0
```

`frames/active-products-echo/product-payload.json`

```json
{
  "nome": "{{getActiveProducts.0.nome}} (copy)",
  "categoria": "{{getActiveProducts.0.categoria}}",
  "preco": "{{getActiveProducts.0.preco}}",
  "ativo": false
}
```

`frames/active-products-echo/created-product.json`

```json
{ "id": "", "nome": "", "categoria": "", "preco": 0, "ativo": false }
```

`frames/active-products-echo/assert-created-product.jsonassert`

```
assert createdProduct.categoria == getActiveProducts[0].categoria
```

Private notes: `frames/active-products-echo/frame.private.yaml` (var-name → notes).

**Trade-offs**

| | |
|---|---|
| C1 | Code diffs are the cleanest (no fences, no indentation); metadata diffs in one manifest. Two people adding cards to the same step conflict in `frame.yaml` |
| C2 | Best for code: editors highlight and validate `.json`/`.sql`/`.js`, `jq` works on fixtures. `.jsonassert` is unknown to editors. `.json` hides that a mongo file is an argument array, not a document |
| C3 | Worse than B: the var-name is in the manifest **and** in the code file's name, the extension repeats the (type, subtype) language, and the loader reconciles again (code file without a card, card whose code file has the wrong extension after a type change). The round-trip rule stays |
| C4 | Best: fully native files |
| C5 | `frame.private.yaml` |
| C6 | YAML for the manifest plus file reconciliation, both sides; more rules than B |
| C7 | Directory replace with many files, not atomic (as today) |
| C8 | Per code file: never a concern |
| C9 | Data sets could be native `.json` files too, which suits large fixtures |

## 4. Comparison

| Criterion | A: per-card `.md` | **B: one YAML per frame** | C: manifest + code files |
|---|---|---|---|
| Files for the example frame | 9 | **1** | 7 |
| C1 diffs / merges | good per card; `flow.md` hotspot | good; conflicts only on adjacent lines | good; manifest hotspot |
| C2 reading outside the IDE | best on GitHub | whole frame at a glance; code not highlighted | best for code; metadata elsewhere |
| C3 one identity, once | no (order and var-name split) | **yes** | no (var-name twice, extension) |
| C4 verbatim code | yes | yes | yes |
| C5 secrets apart | yes | yes | yes |
| C6 parsing twice | medium | **lowest** | medium |
| C7 save | multi-file | **one atomic file** | multi-file |
| C8 2 MiB cap | n/a | per frame | n/a |
| C9 future keys | new file kinds | frame-level keys | new file kinds |
| Cost of the change | small | medium (net code removal) | large |

## 5. Recommendation: Option B

**One YAML file per frame, code as literal block scalars, private notes in
`{frame}.private.yaml`, sources unchanged.**

Why:

1. It removes the structural problems instead of restyling them: the order lives once (list
   position, no `flow.md`), the var-name lives once (`var`, no file-name encoding), and there is
   nothing left to reconcile on load.
2. It is the same move the user already made for sources (#62–#63: no separate file per source
   type, everything in the same YAML): the whole project becomes YAML with one
   convention for private layers (`*.private.yaml`).
3. It is the cheapest to keep in parity: both sides already carry a restricted YAML loader; two
   hand-written parsers (envelope + flow) are deleted on each side, and only the IDE writes.
4. Saving becomes one atomic write — "saving replaces" without a window where a frame is half
   old, half new.
5. The external contracts do not move: the API still exchanges `{frames: [{name, steps: [{number,
   cards}]}]}`; the editor, tour UI, `scripts/push-example.ts`, `scripts/smoke.ts` and the run
   protocol never see the files.

What it costs, said plainly: hand-editing code means keeping YAML indentation; code inside YAML
is not syntax-highlighted in most editors; history and the 2 MiB cap are per frame instead of per
card; and it reverses the 2026-11-21 choice of one `.md` per card with a fenced body (2026-11-21
#2, #116 — see Q1).

### What breaks, and every consumer to update in the same change

No compatibility path: the old `frames/{frame}/step-{n}/*.md` layout stops loading, the
example's old folder is deleted and the example regenerated.

IDE (`modules/testframe-ide`, the owner):

- `lib/format/md-envelope.ts` — deleted.
- `lib/format/frame-codec.ts` — rewritten: one `{frame}.yaml` (+ `.private.yaml`) ↔ `Frame`;
  canonical emitter (key order, `|-` for code, quoting only when needed); `FLOW_FILE`, path
  regexes and `orderStep` removed.
- `lib/format/card-codec.ts` — parses/renders a card map instead of an envelope; `validate`
  keeps its rules (plus `var`); omits default `timeout` and single-subtype `subtype`.
- `lib/format/names.ts` — the var-name ↔ file-name conversion and `isRoundTrip` no longer
  apply to cards (kept only if Q3 keeps the rule); frame `slug` stays.
- `lib/store/project-store.ts` — `frames/` accepts `{frame}.yaml` / `{frame}.private.yaml` (flat)
  instead of `.md` trees; frame save = one atomic write + stale `.private.yaml` removal;
  `GITIGNORE_LINES` drops `*.private.md`; the 2 MiB rule unchanged.
- `lib/services/frame-service.ts` — `save` no longer filters `.md` paths to find kept cards; the
  last-run key in `.testframebuild/` may stay `{frame}/step-{n}/{var-file}` (internal) or become
  `{frame}/{varName}`.
- `editor/frames.ts`, `editor/editor-app.tsx` — the card id built with `varNameToFileName` is
  internal and may stay; `editor/types.ts`, `editor/components/card-edit-modal.tsx` comments and
  `editor/i18n.tsx` `privateDataHint` (en + pt-BR) mention `{var-file}.private.md` → update.
- `scripts/format-dump.ts` — stop filtering `.private.md`; read the new files.
- Tests: `tests/format/{md-envelope,card-codec,frame-codec,names}.test.ts`,
  `tests/store/project-store.test.ts`, `tests/helpers/{example-project,tmp-project}.ts`.
- `examples/product-test/testframe/` — delete `frames/active-products-echo/`, regenerate with
  `bun run example:push` (it goes through the API, so the script itself does not change).

Plugin (`modules/testframe-plugin-spring`, read-only decoders):

- `format/MdEnvelope.java` — deleted.
- `format/FrameDecoder.java`, `format/CardDecoder.java` — decode from `SafeYaml` values.
- `format/ProjectDir.java` — list `frames/*.yaml` (skip `*.private.yaml`) instead of walking
  `.md` trees; `MAX_FILE_BYTES` unchanged.
- `format/SafeYaml.java` — javadoc says it loads the `sources*.yaml` layers; it now loads frames
  too (it already supports maps, lists and block scalars).
- `format/Names.java` — file-name conversion as in the IDE.
- Tests: `FrameDecoderTest`, `CardDecoderTest`, `cli/FormatDumpTest`, and the tests that build
  temporary projects with card files (`api/RedactionBoundaryTest`, `cli/CliInterruptionTest`).
- Tour API: `{frame}` becomes the frame file name without `.yaml` (same value as today's folder
  name, no API change).

Parity: `scripts/format-check.ts` needs no logic change (it compares dumps, and the dump shape
does not change). Add fixtures that exercise YAML edge cases on both readers: code with leading
spaces, tabs, `#`, `: `, `---`/`...` lines, trailing spaces, non-ASCII text, quoted titles.

Docs (same change): `docs/project-format.md` (principles 1–3, 6–7, "Layout", "Cards", "Step
sequence" removed, "Private data", "Example", "API" path rules), `modules/testframe-ide/AGENTS.md`,
`modules/testframe-plugin-spring/AGENTS.md` (`MdEnvelope`, `flow.md`, `.md` only), root
`AGENTS.md` ("a step's card sequence lives only in its `flow.md`", "never a `*.cache.md` beside a
card"), root `README.md` (layout lines), `docs/runner-protocol.md` (`.private.md`, "`flow.md`
order"), `docs/test-tour.md` (`.private.md`), `docs/architecture-split-plan.md` (spec table
mentions `flow.md`), `TODO.md`, and this file deleted once its content is in the spec.

Not affected: `sources*.yaml` and their code, the catalog, code rules, mongo call validation,
jsonassert, the run protocol's JSON, the tour UI, the PDF, `scripts/smoke.ts`.

## 6. Reading (b): test data ("massa de dados")

**Today (keep):** a frame's test data is the code of its input `rawvalue` cards (test-tour
"Input cards"). The tour edits them per run in the browser and never stores the edits (#48,
#49, #69); produced data is never project data: last runs go to `.testframebuild/` (#66–#67) and
evidence only to the PDF (#69). Nothing about (b) needs a file today, and nothing should be added
before the "Later" items exist (split plan §8).

**When data sets arrive** (run a frame N times / with several inputs): a data set is a named set
of replacement values for the frame's input cards — the same thing a tour run sends as
`inputs` (`docs/test-tour.md`, run request). With Option B it is a frame-level key beside the
steps, so it travels with the frame and needs no new file kind. Illustrative shape (the example
project has no data set; the values are the tour spec's own run-request example):

```yaml
data:
  tour-copy:
    productPayload: |-
      { "nome": "Tour copy", "preco": 99 }
step-1:
  - var: getActiveProducts
    # ...
```

Rules it would follow: a data set name is kebab-case; its keys must be input cards of the frame
(the same `400` rule as tour `inputs`); values are JSON text in `|-` scalars; an absent input
keeps the card's saved code. The tour start screen would offer "saved values" or a data set as
the prefill, and the tour still edits freely without saving (the plugin stays read-only; only
the IDE writes a data set).

Generators (faker) are expressions inside card code or data-set text (for example a binding
function inside a JSON string); they are a language design, not a storage one, and need no new
file. Private test data (real documents, customer ids) would go to `{frame}.private.yaml` under
the same `data:` key — which would make that file execution input for the first time (today card
notes are "never execution input"), so it needs its own decision (Q7).

## 7. Open questions (each with the default if unanswered)

| # | Question | Default |
|---|---|---|
| Q1 | Accept Option B, leaving one `.md` per card with a fenced body (the 2026-11-21 choice)? | Yes, B. If per-card files matter more than one identity and fewer parsers, fall back to A |
| Q2 | Omit `timeout` when it is the card type's default, and `subtype` when the type has only one? | Yes, both (principle 2 already asks for the first) |
| Q3 | With no file name to round-trip, relax the var-name rule? | Yes: a camelCase identifier `^[a-z][A-Za-z0-9]*$`, consecutive capitals allowed (`getHTTPData`); `flow` no longer reserved |
| Q4 | Steps as `step-{n}` keys (as proposed) or a `steps:` list? | `step-{n}` keys: mirrors today's names, less indentation, leaves room for frame-level keys |
| Q5 | Card notes in one `{frame}.private.yaml` (var-name → text)? | Yes |
| Q6 | Keep the 2 MiB cap per file now that a file is a whole frame? | Keep it; a frame near it is a sign that fixtures belong in data sets (and those could get their own file then) |
| Q7 | Data sets: reserve the frame-level `data:` key now, or design them when "run N times" is planned? | Design them then; do not put `data:` in the spec before it is implemented. Private data sets: decide then whether `.private.yaml` may become execution input |
| Q8 | Keep layout fields (`size`, `result-height`) in the committed frame, or move them to `.testframebuild/`? | Keep them in the frame: they are authored canvas layout, and moving them would make a frame look different on every machine |

## 8. What was verified, and what was not

Verified by reading: every file of `examples/product-test/testframe/`; `docs/project-format.md`;
`lib/format/{md-envelope,frame-codec,card-codec,catalog,names}.ts`; `lib/store/project-store.ts`
(save = multi-file replace, `writeAtomic` exists, 2 MiB cap); `lib/services/frame-service.ts`;
the plugin's `format/{FrameDecoder,ProjectDir,SafeYaml}.java` headers (`SafeYaml` already loads
maps, lists and typed scalars); `scripts/format-check.ts` (dump shape is layout-independent);
`scripts/push-example.ts` (API only); the journal entries cited above. The "`timeout` always
written" finding is from `card-codec.ts` `render`.

Not verified: no code was run. In particular, not checked by execution that the `yaml` library's
emitter produces `|-` for every code shape listed in §5 (leading spaces, tabs, trailing spaces)
with the chosen options, nor that SnakeYAML (a YAML 1.1 parser under `SafeYaml`'s 1.2 typing)
and `yaml` read those edge cases identically — the parity fixtures in §5 are how the
implementation would prove it.
