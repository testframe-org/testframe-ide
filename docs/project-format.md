# Project format (`{project}/testframe/`)

How a TestFrame project is stored on disk. Contract owners: `client/src/frames.ts`
(zod schemas, serialization) and `server/.../store/ProjectFileStore.java` (storage,
path sanitization, replace semantics). Reference project: `examples/product-test/testframe/`.

The project is in beta: this format changes without migrations or legacy loaders
(see the root `AGENTS.md`).

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

## Sources: `sources/{type-source}/{name-source}.md`

- `{name-source}.md` has one frontmatter key, `base-url`. For `swagger` it points at the
  OpenAPI spec, which fully defines the endpoints, so swagger sources have no scripts.
  For `mongo` it is the connection URI, and for `restapi`/`assert` it is the service URL.
- `{name-source}.private.md` has an empty frontmatter. It is written only when it has content.
- `{name-source}/{script-file}.md` has an empty frontmatter, reserved for future script
  parameters. The body is the query or method. Allowed for every type except `swagger`.

## Private data: `*.private.md` / `*.private.example.md`

- Cards (`{var-file}.private.md`) and sources (`{name-source}.private.md`) keep secrets
  and access notes in a sibling file with an empty frontmatter. The IDE edits it in the
  inspector (cards) and the Sources modal (sources).
- `*.private.md` is gitignored. A versioned `*.private.example.md` next to it is the
  template: it is loaded when the private file is missing, and the next save writes the
  real `.private.md`. The server never deletes `*.private.example.md`.
- `bun run example:push` ships the example project with templates only.

## Bindings and references

- **Bindings between cards:** `{{varName}}` or `{{varName.path.0.field}}` in a JSON body
  resolves to the value published by an earlier card with that var-name. Var-names are
  unique per frame, so a binding is unambiguous.
- **Source scripts:** `source: mongo/products-db` + `script: getActiveProducts` points at
  `sources/mongo/products-db/get-active-products.md`. When the card body is empty,
  the client loads the script body into the card. If the card's code still matches the
  script on save, the body is written empty again. If the user edits the code, it is saved
  as an override. A reference to a missing script loads with a warning in the console.

## API

- `POST /api/v2/frames` `{project, frame, files[{path, content}]}`: `path` is relative to
  `frames/` (`{frame}/step-{n}/{var-file}.md`). Every frame directory in the paths, plus
  `frame`, is replaced. Other frames are untouched.
- `POST /api/v2/sources` `{project, sources[{typeSource, name, publicData, privateData, scripts[{file, content}]}]}`:
  for each sent source, `{type}/{name}.md`, `{type}/{name}.private.md` and the `{type}/{name}/`
  script folder are replaced. Sources that are not sent are untouched.
- The server validates every path before writing. It strips `..`, applies a character
  whitelist, checks that the path stays under the projects dir, accepts only `.md` files,
  and never allows a scope equal to the `frames/` or `sources/` root.

## Example

```
frames/active-products-echo/
  step-1/get-active-products.md  active-products.md  assert-active-products.md
  step-2/echo-payload.md  send-echo.md  send-echo.private.example.md  echo-result.md  assert-echo.md
sources/
  mongo/products-db.md  mongo/products-db/{get-active-products, get-products-by-category}.md
  swagger/product-api.md  swagger/product-api.private.example.md

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

# sources/mongo/products-db.md
-------------------
base-url: mongodb://localhost:27017/products
--------body----------
```

## Notes

- The client shows one frame at a time: the one named in the header, or the first one on
  disk. Saving writes only that frame.
