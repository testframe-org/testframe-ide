# Plan: card-editor autocomplete (mongo, postgres, oracle, jsonassert, openapi/http, json)

Status: proposed 2026-11-22 (journal #117, #118). Scope: the IDE editor (`editor/`, plus catalog
data in `lib/format`). The project format does not change. Only SQL schema completion (phase E)
needs the plugin.

## 1. Where it stands

`editor/autocomplete.ts` (pure, 238 lines) + `editor/components/code-editor.tsx` (textarea and
popup). Two modes, picked in `card-form.tsx` by the card's form:

| Form | Mode | What it suggests today |
|---|---|---|
| `script`, `condition` (jsonassert) | `jsonassert` | `{{bindings}}`; var-names; fields of a var's last-run sample (`var.a.b`); a hand-copied list of 11 `$functions`; 16 keywords |
| `mongo` | `bindings` | only `{{var.path}}` — nothing about the call, operators, options or fields |
| `request`, `swagger` (http/openapi body) | `bindings` | only `{{var.path}}` |
| `json` (rawvalue) | `bindings` | only `{{var.path}}` |
| `query` (sql: `oracle`, `postgres`, `mysql`, `sqlserver`) | none | nothing: no `completion` is passed, not even `{{bindings}}`. The only code rule is Oracle's single `SELECT` (`code-rules.ts:23`) |

Gaps behind those:

1. **No context beyond the current line.** Detection is regexes over the text before the caret.
   Nothing knows "I am in argument 2 of a `find`", "this is a key, not a value" or "I am inside
   `items[ … ]`".
2. **Data duplicated from its owner.** `JSONASSERT_FUNCTIONS` and `JSONASSERT_KEYWORDS` are a copy
   of the engine ("keep in sync"). The keyword list offers words the grammar may not have
   (`while`, `for`, `switch`…). The catalog already serves the mongo `Arg`/`Option` signatures,
   but completion ignores them.
3. **Field samples exist only after a run.** A var that never ran completes by name only, even
   when its shape is known (the openapi response schema, the mongo projection).
4. **SQL cards do not run.** The plugin has no JDBC driver and `RunEngine` has no sql branch, so
   SQL cards produce no last-run sample, and nothing can answer "which tables and columns
   exist".
5. **No feedback beyond the list.** No signature help while typing arguments, no detail/docs pane,
   and no snippets (e.g. an `assert … == …` template or a `$filter` lambda skeleton).

## 2. Design

### 2.1 One completer, one provider per form

Replace the `mode` switch with providers keyed by `FormKind` (from the catalog):
`complete(text, caret, ctx)` dispatches to `providers[ctx.form]`. Each provider gets a small
**context** computed once per keystroke, instead of each doing its own regexes:

- **`jsonContext(text, caret)`**: a tolerant JSON scanner, error-recovering because the text is
  mid-edit. It returns the path to the caret (`[1, "$set", "price"]`), whether the caret is on a
  key or on a value, the enclosing container, and the partial token. It is shared by mongo, the
  request bodies and rawvalue json.
- **`jsonassertContext(text, caret)`**: built on the engine's tokenizer, exported by
  `jsonassert-js`, not re-implemented. It returns the expression path before the caret
  (`items.price`), whether the caret is inside a `[ … ]` predicate (the path is then relative to
  the array item), inside a lambda (its parameters are in scope), or in an argument of a
  `$function` (for signature help).
- The `{{binding}}` provider stays common to every form, as today.

### 2.2 Data comes from its owner, through the catalog

| Data | Owner | How the editor gets it |
|---|---|---|
| jsonassert functions (name, signature, doc), keywords, operators | `jsonassert-js`: export a `FUNCTIONS`/`KEYWORDS` table next to the evaluator; the Java engine gets a parity test on the same table | `GET /api/v2/catalog` → `jsonassert` |
| mongo query operators (`$eq $ne $gt $gte $lt $lte $in $nin $exists $regex $and $or $not $nor $elemMatch $size $all $type`), update operators (`$set $unset $inc $push $pull $addToSet $rename $min $max $currentDate`), pipeline stages (`$match $project $group $sort $limit $skip $unwind $lookup $count $addFields $facet` — never `$out`/`$merge`), accumulators (`$sum $avg $min $max $push $first $last`), EJSON (`$oid $date $numberLong $numberDecimal`) | `lib/format/mongo-call.ts` (already the owner of signatures and guards) | catalog → `mongo` |
| SQL per dialect: keywords, built-in functions with signatures, types; Oracle (`NVL`, `DECODE`, `TO_DATE`, `TO_CHAR`, `SYSDATE`, `ROWNUM`, `FETCH FIRST n ROWS ONLY`, `DUAL`), Postgres (`COALESCE`, `NOW()`, `::type` casts, `ILIKE`, `LIMIT/OFFSET`, `jsonb` operators `->` `->>` `@>` and `jsonb_*` functions, `DATE_TRUNC`) | new `lib/format/sql-dialects.ts` (only what the code rules allow: SELECT-side, no DML/DDL for Oracle) | catalog → `sql[subtype]` |
| SQL schema: tables, views, columns (name, type, nullable) per source and environment | plugin, through a read-only introspection endpoint (phase E); the IDE caches it in `.testframebuild/sql/{source}.{env}.json` like openapi operations | new IDE route, cached per env |
| argument signatures and option keys | `mongo-call.ts` `Arg`/`Option` (already served) | already in the catalog |
| openapi request/response body schemas | `lib/openapi/openapi-spec.ts`: extend `Operation` with a distilled `requestSchema` / `responseSchema` (JSON-Schema subset: properties, types, required, enum, items; `$ref` resolved, depth-capped) in the `.testframebuild/` cache | operations route (already per env) |

The editor keeps no copy of these tables (module rule: "the catalog is data, not code").

### 2.3 Provider behaviour

**jsonassert** (`script`, `condition`)
- Inside `[ … ]` after a path: fields of the array item, plus operators.
- Inside a lambda `function(v) { v.… }`: the parameter's fields, taken from the array the
  `$map`/`$filter` is applied to.
- After a complete operand: comparison operators (`==`, `!=`, `>`, …, `and`, `or`) and `in`.
- In a `$function(` argument: signature help from the catalog (the active parameter is
  highlighted).
- Snippets: `assert {expr} == {value}`, `$filter(arr, function(v) { … })`, `$map(…)`.
- Keywords: only what the grammar has, taken from the engine table.

**mongo** (JSON-array body)
- At the top level, the array position tells which `Arg` the caret is in (`filter`, `projection`,
  `options`, `pipeline`, `update`, `document(s)`). Show signature help with the active argument.
- **filter / projection keys**: the collection's field names, from the card's last `find` result
  or from any earlier mongo card on the same source + collection; `$and`/`$or`/`$nor` at any key
  position.
- **filter value objects** (`{"price": { | }}`): query operators.
- **update arg**: update operators at depth 1, field names at depth 2.
- **pipeline arg**: a stage name at each element's key; inside `$match`, the filter rules; inside
  `$group`, `_id` and accumulators; `$`-prefixed field references (`"$price"`) in values.
- **options arg**: exactly the subtype's `Option` names, with value hints by `OptionKind`
  (`boolean` → `true`/`false`, `hint` → an index-like object).
- Values: EJSON wrappers (`{"$oid": …}`, `{"$date": …}`) and `{{bindings}}`.
- No completion offers a write stage or an option the validator would reject.

**openapi / http** (`request`, `swagger`)
- Body keys from the operation's `requestSchema`: required ones first, with type and enum in the
  detail column; enum values at value positions.
- The var published by an openapi card gets a **schema-derived sample** for later cards (from
  `responseSchema`) when it has no last run, which fills gap 3.
- `endpoint`: path templates of the operation list (`/products/{id}`).

**json** (rawvalue): `{{bindings}}` plus JSON structure help (closing brackets). There is no schema,
so no key suggestions.

**sql** (`query`, per subtype = dialect: `postgres`, `oracle`, then `mysql`, `sqlserver`)
- A small SQL clause scanner (`sqlContext`) tells the clause the caret is in (`SELECT` list,
  `FROM`/`JOIN`, `WHERE`/`ON`, `GROUP BY`, `ORDER BY`), the aliases declared in `FROM`/`JOIN`
  (`p` → `products`), and whether the caret is in a string, a comment (`--`, `/* */`) or a
  `{{binding}}`.
- Without a schema (phases B–C):
  - `{{bindings}}`, including inside string literals (`WHERE nome = '{{productName}}'`);
  - the dialect's keywords by clause, so after `FROM` it suggests a table position and not
    `ORDER`;
  - the dialect's functions with signature help;
  - dialect snippets: Postgres `LIMIT n OFFSET m` and `col::type`; Oracle `FETCH FIRST n ROWS
    ONLY`, `SELECT … FROM DUAL` and `NVL(…)`.
- Oracle: no DML/DDL keyword is offered, because the code rule only accepts one `SELECT`. Postgres
  and the others: also `SELECT`-side only until their code rules say otherwise (a decision in §5).
- With a schema (phase E):
  - `FROM`/`JOIN` → tables and views (Postgres `schema.table`; Oracle `OWNER.TABLE`, uppercased
    as stored);
  - `alias.` → that table's columns;
  - `SELECT`/`WHERE`/`ORDER BY` → the columns of the tables in scope, with type and nullable in the
    detail column;
  - Postgres `jsonb` columns: their keys after `->`/`->>`, from the last run's rows.
- Rows from the last run of a SQL card (once the plugin runs them) feed later cards' field
  completion, like the mongo and http results do today.

### 2.4 Editor surface

Keep the textarea and popup, and add three pieces to `code-editor.tsx`:
- a detail pane next to the selected item (signature + one-line doc, i18n en/pt-BR for IDE-owned
  docs; engine docs in English);
- inline signature help above the caret while inside call arguments;
- snippet placeholders (Tab jumps to the next one).

## 3. Phases

| # | Work | Thread (`agents/threads/`) | Files |
|---|---|---|---|
| A1 | `jsonassert-js` exports `FUNCTIONS`/`KEYWORDS`/`OPERATORS` (name, signature, doc) and a tolerant tokenizer; Java parity test on the function table | `specialist` | `modules/jsonassert/modules/jsonassert-{js,java}` |
| A2 | Mongo operator/stage/accumulator/EJSON tables in `mongo-call.ts`; openapi `requestSchema`/`responseSchema` distilled into the cache; both served by the catalog / operations route; `format:check` unaffected (cache is not format) | `specialist` | `lib/format/mongo-call.ts`, `lib/openapi/*`, `lib/api/domain.ts`, `app/api/v2/catalog` |
| A3 | `lib/format/sql-dialects.ts` (Postgres and Oracle first, then MySQL and SQL Server), served by the catalog | `specialist` | `lib/format/sql-dialects.ts`, `lib/format/catalog.ts`, `lib/api/domain.ts` |
| B | `autocomplete.ts` split into `autocomplete/{index,json-context,jsonassert-context,bindings,providers/*}.ts`; `form`-keyed dispatch; drop the hand-copied tables | `implementer` | `editor/autocomplete/**`, `card-form.tsx`, `mongo-args-editor.tsx` |
| C | Providers: jsonassert, mongo, openapi, json, sql (bindings + keywords); schema-derived samples for never-run openapi vars in `completionVarsFor` | `implementer` | `editor/autocomplete/providers/*`, `editor/editor-app.tsx` |
| D | Detail pane, signature help, snippet placeholders; i18n en/pt-BR; browser pass (caret on a zoomed canvas, long scripts) | `frontend` | `editor/components/code-editor.tsx`, `editor/i18n.tsx` |
| E1 | Plugin executes SQL cards (JDBC drivers for Postgres and Oracle, read-only connection, `setReadOnly(true)` + statement timeout + row cap, results redacted like any card); runner-protocol updated | `implementer` (+ `guardian` review) | `modules/testframe-plugin-spring`, `docs/runner-protocol.md` |
| E2 | Plugin `POST /api/v1/introspect` (self-contained: resolved source + secrets) returning tables, views and columns from `information_schema` (Postgres) / `ALL_TAB_COLUMNS` + `ALL_VIEWS` (Oracle), capped and filtered by schema/owner; IDE route + `.testframebuild/sql/` cache + refresh button; schema provider | `implementer` (+ `guardian` review) | plugin `api/` + `engine/`, IDE `lib/services`, `app/api/v2/sources/sql/**`, `editor/autocomplete/providers/sql.ts` |

Order: A1 ∥ A2 ∥ A3 → B → C → D. B can start on A's interfaces, since it only needs the table
types. E1 → E2 is independent of B–D and can run in parallel after A3.

## 4. Acceptance

- `bun test` gains `tests/editor/autocomplete/*.test.ts`. Each provider has table-driven cases of
  the form (text with a caret marker → expected labels), including mid-edit invalid JSON. Examples:
  - `[{"price": {"$g|` → `$gt`, `$gte`;
  - `[{}, {"$s|` in `updateOne` → `$set`;
  - `[{"$match": {}}, {"$|` in `aggregation` → stages without `$out`/`$merge`;
  - `[{}, {}, {"|` in `find` → exactly `find`'s option names;
  - `items[pr|` → item fields;
  - `$filter(items, function(v) { v.|` → item fields;
  - a never-run openapi var → fields from `responseSchema`.
- There is no copy of an engine or catalog table under `editor/` (checked by `rg` in review), and
  the `jsonassert` function table has a JS↔Java parity test.
- `bun test && bun run typecheck && bun run build` are green. `assert:check` and `format:check`
  are unchanged.
- SQL tests: `SELECT p.| FROM products p` (with a cached schema) → the `products` columns;
  `FROM |` → tables; Oracle never offers `INSERT`/`DELETE`; `WHERE nome = '{{pro|` → bindings;
  Postgres `data->>'|` → keys from the last run.
- E1/E2: plugin tests against Testcontainers Postgres (Oracle Free if it is practical in CI,
  otherwise a documented manual check); the introspection response carries no secret; a write
  statement on a read-only connection fails.
- Browser pass on `product-test`: mongo `find` on `products` suggests `nome`/`ativo` after one run;
  an assert card completes `$count(` with signature help.

## 5. Decisions for the user

1. **Keep the textarea or move to CodeMirror 6.** CodeMirror brings a JSON parser, completion,
   signature tooltips and snippets for free, but it is a dependency and replaces `code-editor.tsx`
   and the highlighter. Recommendation: keep the textarea for B–C, since the pure providers are
   editor-agnostic, and decide at D.
2. **Collection field names from a live sample.** The alternative to "last run" is a
   `$sample`/`findOne` through the plugin on demand. That is a new plugin endpoint and an execution
   against the environment just to type. Recommendation: last runs plus earlier cards only.

3. **What SQL may do per dialect.** Oracle cards are single-`SELECT` today, while Postgres, MySQL
   and SQL Server have no rule. Recommendation: the same single-`SELECT` rule for every dialect
   (read-only, like the tour's spirit), which also keeps completion `SELECT`-side.
4. **SQL execution in the plugin (E1)** is a new capability, not only completion. Drivers add
   size to the jar (the Oracle driver is about 7 MB), and the example `product-test` has no SQL
   database, so the example would need one (a Postgres container) to be demonstrable.

## 6. Later

- MySQL and SQL Server schema introspection (same endpoint, other catalog queries).
- Hover docs on existing code (not only while completing).
- Inline diagnostics (squiggles) from `POST /api/v2/validate` instead of the status line.
