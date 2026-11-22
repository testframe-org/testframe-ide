package com.testframe.server.format;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardRun;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
import com.testframe.server.dto.Source;
import com.testframe.server.dto.SourceScript;
import com.testframe.server.dto.Step;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CardCodecTest {

    private static final ScriptLookup EXAMPLE_SCRIPTS = ScriptLookup.of(SourceCodec.read(ExampleProject.sources()));

    private static Card card(String varName, String sourceType, String sourceName, String script, String code) {
        return new Card(varName, "Title of " + varName, null, null, sourceType, sourceName, script, "", null,
                null, null, null, null, code, null, null);
    }

    @Test
    void everyCommittedCardFileRoundTrips() {
        List<ProjectFile> cards = ExampleProject.frames().stream()
                .filter(f -> !f.path().contains(".private."))
                .toList();
        assertFalse(cards.isEmpty());
        for (ProjectFile file : cards) {
            String fileName = file.path().substring(file.path().lastIndexOf('/') + 1);
            CardCodec.Parsed parsed = CardCodec.parse(fileName.replace(".md", ""), file.content(), EXAMPLE_SCRIPTS);
            assertEquals(List.of(), parsed.errors(), file.path());
            assertEquals(List.of(), parsed.warnings(), file.path());
            Card card = parsed.card();
            Optional<String> script = card.script() == null ? Optional.empty()
                    : EXAMPLE_SCRIPTS.body(card.sourceType(), card.sourceName(), card.script());
            assertEquals(file.content(), CardCodec.render(card, parsed.order(), script), file.path());
        }
    }

    @Test
    void everyCommittedFrameRoundTripsThroughTheFrameCodec() {
        List<ProjectFile> committed = ExampleProject.frames();
        FramesResponse read = FrameCodec.read(committed, EXAMPLE_SCRIPTS);
        assertEquals(List.of(), read.errors());
        assertEquals(1, read.frames().size());

        Frame frame = read.frames().getFirst();
        assertEquals("active-products-echo", frame.name());
        Card getActive = frame.steps().getFirst().cards().getFirst();
        assertEquals("getActiveProducts", getActive.varName());
        assertEquals("js", getActive.type());
        assertEquals("db.products.find({ ativo: true })", getActive.code(), "body inherited from the source script");
        Card sendEcho = frame.steps().get(1).cards().get(1);
        assertEquals("POST", sendEcho.httpMethod());
        assertEquals(360, sendEcho.width());
        assertEquals("# Headers\nX-Api-Key: <local-dev-key>", sendEcho.privateData(), "template is the fallback");

        FrameCodec.Written written = FrameCodec.write(frame, EXAMPLE_SCRIPTS);
        Map<String, String> byPath = committed.stream().collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(committed.size(), written.files().size());
        for (ProjectFile file : written.files()) {
            String path = ExampleProject.committedPathOf(file.path(), committed);
            assertEquals(byPath.get(path), file.content(), path);
        }
    }

    @Test
    void cardBoundToAnUnchangedScriptStoresAnEmptyBody() {
        Optional<String> script = Optional.of("db.x.find()\n");
        String inherited = CardCodec.render(card("runQuery", "mongo", "db", "runQuery", "db.x.find()"), 1, script);
        assertTrue(inherited.endsWith("-------------------\n"));
        String overridden = CardCodec.render(card("runQuery", "mongo", "db", "runQuery", "db.y.find()"), 1, script);
        assertTrue(overridden.endsWith("-------------------\n```js\ndb.y.find()\n```\n"));

        CardCodec.Parsed loaded = CardCodec.parse("run-query", inherited, (type, name, s) -> script);
        assertEquals("db.x.find()", loaded.card().code());
    }

    @Test
    void missingScriptLoadsWithAWarning() {
        String md = CardCodec.render(card("runQuery", "mongo", "db", "runQuery", ""), 1, Optional.empty());
        CardCodec.Parsed loaded = CardCodec.parse("run-query", md, ScriptLookup.NONE);
        assertEquals(List.of("script \"runQuery\" not found in source mongo/db"), loaded.warnings());
        assertEquals("", loaded.card().code());
    }

    @Test
    void defaultsComeFromTheTypeAndSizeIsWrittenOnlyWhenDifferent() {
        String json = CardCodec.render(card("payload", "inline", "", null, "{}"), 2, Optional.empty());
        assertEquals("""
                -------------------
                title: Title of payload
                order: 2
                timeout: 2000
                -------------------
                ```json
                {}
                ```
                """, json);
        Card big = new Card("sendIt", " ", null, null, "restapi", "api", null, " POST /x ", null,
                8000, 360, 300, 120, "", null, null);
        assertEquals("""
                -------------------
                title: sendIt
                order: 1
                source: restapi/api
                endpoint: POST /x
                timeout: 8000
                size: 360x300
                result-height: 120
                -------------------
                """, CardCodec.render(big, 1, Optional.empty()));
        Card parsed = CardCodec.parse("send-it", CardCodec.render(big, 1, Optional.empty()), ScriptLookup.NONE).card();
        assertEquals("request", parsed.type());
        assertEquals("POST", parsed.httpMethod());
        assertEquals(120, parsed.resultHeight());
        assertEquals("api", parsed.sourceName());
    }

    @Test
    void cardTypeFollowsTheSourceType() {
        Map<String, String> expected = Map.ofEntries(
                Map.entry("restapi", "request"), Map.entry("graphql", "request"), Map.entry("swagger", "request"),
                Map.entry("mongo", "js"), Map.entry("kafka", "js"), Map.entry("grpc", "js"),
                Map.entry("oracle", "sql"), Map.entry("postgres", "sql"), Map.entry("mysql", "sql"),
                Map.entry("sqlserver", "sql"), Map.entry("filter", "jsonassert"), Map.entry("mapper", "jsonassert"),
                Map.entry("assert", "validation"), Map.entry("inline", "json"), Map.entry("", "json"));
        expected.forEach((source, type) -> assertEquals(type, Catalog.cardTypeOf(source), source));
        assertEquals(Catalog.SOURCE_TYPES.size(), Catalog.SOURCE_TYPES.stream().filter(t -> expected.containsKey(t)).count());
    }

    @Test
    void frontmatterSchema() {
        assertEquals(List.of("title: required", "order: required"), CardCodec.validate(Map.of()));
        assertEquals(List.of("order: must be >= 1"), CardCodec.validate(Map.of("title", "A", "order", "0")));
        assertEquals(List.of("source: unknown type-source"),
                CardCodec.validate(Map.of("title", "A", "order", "1", "source", "ftp/x")));
        assertEquals(List.of("script: script requires source: {type-source}/{name-source}"),
                CardCodec.validate(Map.of("title", "A", "order", "1", "source", "mongo", "script", "getAll")));
        assertEquals(List.of("timeout: must be <= 120000", "size: size must be {width}x{height}", "result-height: must be >= 24"),
                CardCodec.validate(Map.of("title", "A", "order", "1", "timeout", "999999", "size", "big", "result-height", "3")));
        assertEquals(List.of("order: expected an integer"), CardCodec.validate(Map.of("title", "A", "order", "1.5")));
        assertEquals(List.of(), CardCodec.validate(Map.of("title", "A", "order", "1e1")));
    }

    @Test
    void resultSiblingRoundTrips() {
        CardRun run = new CardRun("success", "POST /api/v2/echo\n  201", "{\"ok\": true}", "0.12s", "2026-11-21T10:00:00Z");
        String md = CardCodec.renderResult(run);
        assertEquals("""
                -------------------
                status: success
                ran-at: 2026-11-21T10:00:00Z
                elapsed: 0.12s
                summary: POST /api/v2/echo 201
                -------------------
                ```json
                {"ok": true}
                ```
                """, md);
        assertEquals(new CardRun("success", "POST /api/v2/echo 201", "{\"ok\": true}", "0.12s", "2026-11-21T10:00:00Z"),
                CardCodec.parseResult(md));
        CardRun raw = CardCodec.parseResult("ok");
        assertEquals("idle", raw.status());
        assertNull(raw.ranAt());
    }

    @Test
    void frameWriteRejectsDuplicateAndUnstorableVarNames() {
        Frame duplicate = new Frame("Main", List.of(
                new Step(1, List.of(card("getData", "inline", "", null, "{}"))),
                new Step(2, List.of(card("getData", "inline", "", null, "{}")))));
        FormatException e = assertThrows(FormatException.class, () -> FrameCodec.write(duplicate, ScriptLookup.NONE));
        assertEquals("var-name \"getData\" is used twice (step 1 \"Title of getData\" and step 2 \"Title of getData\")",
                e.getMessage());

        Frame lossy = new Frame("Main", List.of(new Step(1, List.of(card("getHTTPData", "inline", "", null, "{}")))));
        e = assertThrows(FormatException.class, () -> FrameCodec.write(lossy, ScriptLookup.NONE));
        assertEquals("var-name \"getHTTPData\" cannot be stored; use \"getHttpdata\"", e.getMessage());

        Card badTimeout = new Card("slow", "Slow", null, null, "inline", "", null, "", null, 50, null, null, null, "", null, null);
        e = assertThrows(FormatException.class,
                () -> FrameCodec.write(new Frame("Main", List.of(new Step(1, List.of(badTimeout)))), ScriptLookup.NONE));
        assertEquals("step 1 \"Slow\": timeout: must be >= 100", e.getMessage());
    }

    @Test
    void frameWriteNumbersStepsAndCardsByPositionAndDerivesMissingVarNames() {
        Card untitledVar = new Card(null, "Echo payload", null, 9, null, null, null, null, null, null, null, null, null,
                "{}", "secret", null);
        FrameCodec.Written written = FrameCodec.write(new Frame("My Flow", List.of(
                new Step(7, List.of(card("first", "inline", "", null, "1"), untitledVar)))), ScriptLookup.NONE);
        assertEquals("my-flow", written.dir());
        Map<String, String> files = written.files().stream()
                .collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(List.of("my-flow/step-1/echo-payload.md", "my-flow/step-1/echo-payload.private.md", "my-flow/step-1/first.md"),
                files.keySet().stream().sorted().toList());
        assertTrue(files.get("my-flow/step-1/echo-payload.md").contains("order: 2\n"));
        assertEquals("-------------------\n-------------------\nsecret\n", files.get("my-flow/step-1/echo-payload.private.md"));
    }

    @Test
    void frameReadReportsInvalidFilesAndOrphanPrivates() {
        List<ProjectFile> files = List.of(
                new ProjectFile("main/step-1/a.md", "-------------------\ntitle: A\n-------------------\n"),
                new ProjectFile("main/step-1/b.private.md", "-------------------\n-------------------\nx\n"),
                new ProjectFile("main/notes.md", "x"));
        FramesResponse read = FrameCodec.read(files, ScriptLookup.NONE);
        assertEquals(List.of(
                "main/step-1/a.md: order: required",
                "main/notes.md: path must be {frame}/step-{n}/{var-name}.md",
                "main/step-1/b: private data without a card (main/step-1/b.md missing)"), read.errors());
        assertEquals(List.of(), read.frames());
    }

    @Test
    void frameReadSortsStepsNumericallyAndCardsByOrder() {
        Function<Integer, String> md = order -> "-------------------\ntitle: T\norder: " + order + "\n-------------------\n";
        List<ProjectFile> files = List.of(
                new ProjectFile("main/step-10/z.md", md.apply(1)),
                new ProjectFile("main/step-2/b.md", md.apply(2)),
                new ProjectFile("main/step-2/c.md", md.apply(1)),
                new ProjectFile("main/step-2/c.result-data.md", CardCodec.renderResult(new CardRun("error", "boom", "", "1s", null))));
        Frame frame = FrameCodec.read(files, ScriptLookup.NONE).frames().getFirst();
        assertEquals(List.of(1, 2), frame.steps().stream().map(Step::number).toList());
        assertEquals(List.of("c", "b"), frame.steps().getFirst().cards().stream().map(Card::varName).toList());
        assertEquals("error", frame.steps().getFirst().cards().getFirst().lastRun().status());
        assertEquals("z", frame.steps().get(1).cards().getFirst().varName());
    }

    @Test
    void scriptLookupMatchesTypeNameAndScript() {
        ScriptLookup lookup = ScriptLookup.of(List.of(new Source("mongo", "db", null, "", "", List.of(new SourceScript("getAll", "q")))));
        assertEquals(Optional.of("q"), lookup.body("mongo", "db", "getAll"));
        assertEquals(Optional.empty(), lookup.body("restapi", "db", "getAll"));
        assertEquals(Optional.empty(), lookup.body("mongo", "db", "other"));
    }
}
