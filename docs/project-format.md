# Project format (`{project}/testframe/`)

How a TestFrame project is stored on disk. Contract owners: `client/src/frames.ts`
(zod schemas, serialization) and `server/.../store/ProjectFileStore.java` (storage,
path sanitization, replace semantics). Reference project: `examples/product-test/testframe/`.

## Principles

1. **The path is the identity.** Frame, step number, card variable, source type/name and
   script name are read from the path only. Frontmatter never repeats them, so renaming a
   file or folder cannot leave it contradicting its own frontmatter.
2. **Frontmatter stores only what the path cannot express**, and omits values equal to
   their defaults (`size`) or empty (`endpoint`, `source`). It may be empty.
3. **One envelope for every file:** a `-------------------` line, `key: value` lines, then
   `--------body----------` followed by the body.
4. **No duplicated code.** A card that runs a source script references it (`script:`)
   and stores an empty body. The card only has its own body when it overrides the script.
5. **Saving replaces.** Saving a frame replaces its whole directory, and saving a source
   replaces its directory too. Removed cards and scripts do not linger on disk.

## Layout

```
{project}/testframe/
  frames/
    {frame}/                       one flow (canvas), kebab-case, e.g. active-products-echo
      step-{n}/                    step number n (1-based, ordered numerically)
        {var-file}.md              one card; var-name = camelCase(var-file)
  sources/
    {type-source}/{name-source}/   e.g. mongo/products-db
      public-data.md               base-url + documentation
      private-data.md              optional (credentials/access notes)
      scripts/{script-file}.md     one custom query/method; script name = camelCase(script-file)
```

The names convert both ways: `getActiveProducts` ↔ `get-active-products.md`. Var-names
must be camelCase with no consecutive capitals (`getHttpData`, not `getHTTPData`), or the
round trip would lose information. The inspector normalizes input, and save rejects
duplicate var-names within a frame, because var-names are the binding identity.

## Cards: `frames/{frame}/step-{n}/{var-file}.md`

| Key | Required | Meaning |
|---|---|---|
| `title` | yes | display name on the canvas (free text) |
| `type` | yes | `request` \| `script` \| `json` \| `validation` |
| `phase` | yes | `pre` \| `post` (column inside the step) |
| `order` | yes | 1-based position inside the phase |
| `source` | no | `{type-source}/{name-source}` (or just `{type-source}`); omitted = inline |
| `script` | no | camelCase script of `source`; empty body = inherit it |
| `endpoint` | no | `METHOD /path` for requests (HTTP method is parsed from it) |
| `timeout` | no | ms; default per type (request/script 5000, json 2000, validation 1000) |
| `size` | no | `{width}x{height}`, only when different from the type default |

Derived, never stored: card id (`{frame}/step-{n}/{var-file}`), step id/number,
var-name, http-method.

## Sources: `sources/{type-source}/{name-source}/`

- `public-data.md` has one frontmatter key, `base-url`. For `swagger` it points at the
  OpenAPI spec, which fully defines the endpoints, so swagger sources have no scripts.
  For `mongo` it is the connection URI, and for `restapi`/`assert` it is the service URL.
- `private-data.md` has an empty frontmatter. It is written only when it has content.
- `scripts/{script-file}.md` has an empty frontmatter, reserved for future script
  parameters. The body is the query or method. Allowed for every type except `swagger`.

## Bindings and references

- **Bindings between cards:** `{{varName}}` or `{{varName.path.0.field}}` in a JSON body
  resolves to the value published by an earlier card with that var-name. Var-names are
  unique per frame, so a binding is unambiguous.
- **Source scripts:** `source: mongo/products-db` + `script: getActiveProducts` points at
  `sources/mongo/products-db/scripts/get-active-products.md`. When the card body is empty,
  the client loads the script body into the card. If the card's code still matches the
  script on save, the body is written empty again. If the user edits the code, it is saved
  as an override. A reference to a missing script loads with a warning in the console.

## API

- `POST /api/v2/frames` `{project, frame, files[{path, content}]}`: `path` is relative to
  `frames/` (`{frame}/step-{n}/{var-file}.md`). Every frame directory in the paths, plus
  `frame`, is replaced. Other frames are untouched.
- `POST /api/v2/sources` `{project, sources[...]}`: each sent `{type}/{name}` directory is
  replaced. Sources that are not sent are untouched.
- The server validates every path before writing. It strips `..`, applies a character
  whitelist, checks that the path stays under the projects dir, accepts only `.md` files,
  and never allows a scope equal to the `frames/` or `sources/` root.

## Before / after

Before, there was one top-level "frame" folder per card. It was named after the card title, so a
two-step flow was spread over eight folders, and a stale card (`consultar-produtos-ativos`,
oracle) was left behind because saves never deleted anything:

```
frames/obter-produtos-ativos/step-1/obter-produtos-ativos.md
frames/active-products-result/step-1/produtos-ativos.md
frames/payload-entrada/step-2/payload-echo.md
...

# frames/obter-produtos-ativos/step-1/obter-produtos-ativos.md
-------------------
card-id: card-1-pre-1
step-id: step-1
step-number: 1
frame-name: Obter produtos ativos
var-name: obterProdutosAtivos
card-type: script
phase: pre
order: 1
type-source: mongo
type-name-source: products-db
endpoint: db.products.find({ ativo: true })
timeout: 5000
width: 340
height: 290
--------body----------
// Custom query from products-db (scripts/obter-produtos-ativos.md)
const products = await db.collection('products').find({ ativo: true }).toArray();
...
```

After, there is one folder per flow and one folder per step. The card references the script:

```
frames/active-products-echo/
  step-1/get-active-products.md  active-products.md  assert-active-products.md
  step-2/echo-payload.md  send-echo.md  echo-result.md  assert-echo.md

# frames/active-products-echo/step-1/get-active-products.md
-------------------
title: Get active products
type: script
phase: pre
order: 1
source: mongo/products-db
script: getActiveProducts
timeout: 5000
--------body----------
```

Source files lost the frontmatter keys that the path already provides:

```
# before: sources/mongo/products-db/public-data.md
name-source: products-db / type-source: mongo / kind: public-data / project: product-test / base-url: ...
# after
-------------------
base-url: mongodb://localhost:27017/products
--------body----------
```

## Compatibility

- Sources and scripts in the old format still load. Unknown frontmatter keys are ignored,
  plain `.md` files without the envelope are read as their body, and identity always
  comes from the path.
- Cards in the old layout (`frames/{card-title}/{step-id}/...` with `card-id`, ...) are
  **not** loaded. They are reported as errors in the console. `bun run example:push`
  regenerates the only existing project.
- The client shows one frame at a time: the one named in the header, or the first one on
  disk. Saving writes only that frame.
