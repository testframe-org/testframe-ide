package com.testframe.server.format;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardRun;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
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

    private static Card card(String varName, String sourceType, String sourceName, String code) {
        String subtype = switch (sourceType) {
            case "mongo" -> "find";
            case "rawvalue" -> "json";
            default -> null;
        };
        return new Card(varName, "Title of " + varName, null, sourceType, subtype,
                "mongo".equals(sourceType) ? "products" : null, sourceName, "", null, null,
                null, null, null, null, code, null, null);
    }

    @Test
    void everyCommittedCardFileRoundTrips() {
        List<ProjectFile> cards = ExampleProject.frames().stream()
                .filter(f -> !f.path().endsWith("/flow.md"))
                .toList();
        assertFalse(cards.isEmpty());
        for (ProjectFile file : cards) {
            String fileName = file.path().substring(file.path().lastIndexOf('/') + 1);
            CardCodec.Parsed parsed = CardCodec.parse(fileName.replace(".md", ""), file.content());
            assertEquals(List.of(), parsed.errors(), file.path());
            assertEquals(file.content(), CardCodec.render(parsed.card()), file.path());
        }
    }

    @Test
    void everyCommittedFrameRoundTripsThroughTheFrameCodec() {
        List<ProjectFile> committed = ExampleProject.frames();
        FramesResponse read = FrameCodec.read(committed);
        assertEquals(List.of(), read.errors());
        assertEquals(1, read.frames().size());

        Frame frame = read.frames().getFirst();
        assertEquals("active-products-echo", frame.name());
        Card getActive = frame.steps().getFirst().cards().getFirst();
        assertEquals("getActiveProducts", getActive.varName());
        assertEquals("query", getActive.type());
        assertEquals("mongo", getActive.sourceType());
        assertEquals("find", getActive.subtype());
        assertEquals("products", getActive.collection());
        assertEquals("{ \"filter\": { \"ativo\": true } }", getActive.code(),
                "the card holds its own code");
        Card activeProducts = frame.steps().getFirst().cards().get(1);
        assertEquals("rawvalue", activeProducts.sourceType(), "every card declares its type-source");
        assertEquals("json", activeProducts.type());
        Card assertActive = frame.steps().getFirst().cards().get(2);
        assertEquals("jsonassert", assertActive.sourceType());
        assertEquals("script", assertActive.subtype());
        assertEquals("jsonassert", assertActive.type());
        Card createProduct = frame.steps().get(1).cards().get(1);
        assertEquals("openapi", createProduct.sourceType());
        assertEquals("restapi", createProduct.subtype());
        assertEquals("product-api", createProduct.sourceName());
        assertEquals("POST", createProduct.httpMethod());
        assertEquals(360, createProduct.width());
        assertNull(createProduct.privateData(), "no .private.md: no private data (there are no templates)");

        FrameCodec.Written written = FrameCodec.write(frame);
        Map<String, String> byPath = committed.stream().collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(committed.size(), written.files().size());
        for (ProjectFile file : written.files()) {
            assertEquals(byPath.get(file.path()), file.content(), file.path());
        }
    }

    @Test
    void defaultsComeFromTheTypeAndSizeIsWrittenOnlyWhenDifferent() {
        String json = CardCodec.render(card("payload", "rawvalue", "", "{}"));
        assertEquals("""
                -------------------
                title: Title of payload
                source: rawvalue
                subtype: json
                timeout: 2000
                -------------------
                ```json
                {}
                ```
                """, json);
        Card big = new Card("sendIt", " ", null, "openapi", "restapi", null, "api", " POST /x ", null, null,
                8000, 360, 300, 120, "", null, null);
        assertEquals("""
                -------------------
                title: sendIt
                source: openapi/api
                subtype: restapi
                endpoint: POST /x
                timeout: 8000
                size: 360x300
                result-height: 120
                -------------------
                """, CardCodec.render(big));
        Card parsed = CardCodec.parse("send-it", CardCodec.render(big)).card();
        assertEquals("request", parsed.type());
        assertEquals("POST", parsed.httpMethod());
        assertEquals(120, parsed.resultHeight());
        assertEquals("api", parsed.sourceName());
        assertEquals("restapi", parsed.subtype());
    }

    @Test
    void cardTypeAndLanguageFollowTypeAndSubtype() {
        // "type/subtype" -> "cardType language"
        Map<String, String> expected = Map.ofEntries(
                Map.entry("openapi/restapi", "request js"), Map.entry("openapi/swagger", "request json"),
                Map.entry("openapi/graphql", "request js"),
                Map.entry("mongo/find", "query json"), Map.entry("mongo/aggregation", "query json"),
                Map.entry("sql/oracle", "sql sql"), Map.entry("sql/postgres", "sql sql"), Map.entry("sql/mysql", "sql sql"),
                Map.entry("sql/sqlserver", "sql sql"),
                Map.entry("jsonassert/script", "jsonassert jsonassert"), Map.entry("jsonassert/conditional", "condition jsonassert"),
                Map.entry("kafka/", "js js"), Map.entry("grpc/", "js js"), Map.entry("rawvalue/json", "json json"));
        expected.forEach((key, value) -> {
            String[] k = key.split("/", -1);
            String subtype = k[1].isEmpty() ? null : k[1];
            assertEquals(value, Catalog.cardTypeOf(k[0], subtype) + " " + Catalog.languageOf(k[0], subtype), key);
            assertNull(Catalog.subtypeProblem(k[0], subtype), key);
        });
        long kinds = Catalog.TYPES.stream().mapToLong(t -> t.kinds().size()).sum();
        assertEquals(expected.size(), kinds, "every (type, subtype) is covered");
        assertEquals(List.of("openapi", "mongo", "sql", "jsonassert", "kafka", "grpc", "rawvalue"), Catalog.SOURCE_TYPES);
        assertEquals(List.of("openapi", "mongo", "sql", "kafka", "grpc"),
                Catalog.SOURCE_TYPES.stream().filter(Catalog::hasSources).toList(), "rawvalue and jsonassert are sourceless");
    }

    @Test
    void frontmatterSchema() {
        assertEquals(List.of("title: required", "source: required ({type-source}/{name-source}, or rawvalue)"),
                CardCodec.validate(Map.of()));
        assertEquals(List.of("source: required ({type-source}/{name-source}, or rawvalue)"),
                CardCodec.validate(Map.of("title", "A")), "every card declares its type-source");
        assertEquals(List.of("source: unknown type-source"),
                CardCodec.validate(Map.of("title", "A", "source", "ftp/x")));
        assertEquals(List.of("script: sources have no scripts; the card holds its own code"),
                CardCodec.validate(Map.of("title", "A", "source", "mongo/db", "subtype", "find", "collection", "x", "script", "getAll")),
                "source scripts were removed: a card always holds its own code");
        assertEquals(List.of("timeout: must be <= 120000", "size: size must be {width}x{height}", "result-height: must be >= 24"),
                CardCodec.validate(Map.of("title", "A", "source", "rawvalue", "subtype", "json", "timeout", "999999", "size", "big", "result-height", "3")));
        assertEquals(List.of(), CardCodec.validate(Map.of("title", "A", "source", "rawvalue", "subtype", "json", "timeout", "5e3")));
    }

    @Test
    void subtypeIsRequiredExactlyForTypesWithSubtypes() {
        assertEquals(List.of("subtype: required for mongo (find, aggregation)"),
                CardCodec.validate(Map.of("title", "A", "source", "mongo/db", "collection", "x")));
        assertEquals(List.of("subtype: unknown subtype \"update\" of mongo (find, aggregation)"),
                CardCodec.validate(Map.of("title", "A", "source", "mongo/db", "subtype", "update", "collection", "x")));
        assertEquals(List.of("subtype: unknown subtype \"find\" of rawvalue (json)"),
                CardCodec.validate(Map.of("title", "A", "source", "rawvalue", "subtype", "find")));
        assertEquals(List.of("subtype: required for rawvalue (json)"),
                CardCodec.validate(Map.of("title", "A", "source", "rawvalue")));
        assertEquals(List.of("subtype: kafka has no subtypes"),
                CardCodec.validate(Map.of("title", "A", "source", "kafka/bus", "subtype", "x")));
        assertEquals(List.of(), CardCodec.validate(Map.of("title", "A", "source", "sql/db", "subtype", "postgres")));
    }

    @Test
    void openapiCardsNameTheirOperationById() {
        Card create = new Card("createProduct", "Create", null, "openapi", "restapi", null, "product-api", "POST /api/products",
                "create", null, null, null, null, null, "", null, null);
        String md = CardCodec.render(create);
        assertEquals("""
                -------------------
                title: Create
                source: openapi/product-api
                subtype: restapi
                endpoint: POST /api/products
                openapi-id: create
                timeout: 5000
                -------------------
                """, md);
        assertEquals("create", CardCodec.parse("create-product", md).card().openapiId());
        assertEquals(List.of("openapi-id: only openapi cards name a spec operation"),
                CardCodec.validate(Map.of("title", "A", "source", "mongo/db", "subtype", "find", "collection", "x", "openapi-id", "create")));
        assertEquals(List.of("openapi-id: must be the spec's operationId (letters, digits, _ . -)"),
                CardCodec.validate(Map.of("title", "A", "source", "openapi/api", "subtype", "restapi", "openapi-id", "a b")));
    }

    @Test
    void mongoCardsNameTheirCollection() {
        Card find = new Card("getAll", "Get all", null, "mongo", "find", "products", "db", "", null, null,
                null, null, null, null, "{ \"filter\": {} }", null, null);
        String md = CardCodec.render(find);
        assertTrue(md.startsWith("""
                -------------------
                title: Get all
                source: mongo/db
                subtype: find
                collection: products
                timeout: 5000
                -------------------
                """), md);
        assertEquals("products", CardCodec.parse("get-all", md).card().collection());
        assertEquals(List.of("collection: required on mongo cards (the collection the query reads)"),
                CardCodec.validate(Map.of("title", "A", "source", "mongo/db", "subtype", "find")));
        assertEquals(List.of("collection: system collections cannot be queried"),
                CardCodec.validate(Map.of("title", "A", "source", "mongo/db", "subtype", "find", "collection", "system.users")));
        assertEquals(List.of("collection: only mongo cards name a collection"),
                CardCodec.validate(Map.of("title", "A", "source", "rawvalue", "subtype", "json", "collection", "x")));
    }

    @Test
    void sourcelessTypesWriteTheTypeAlone() {
        assertEquals(List.of("source: jsonassert cards have no name-source (write source: jsonassert)"),
                CardCodec.validate(Map.of("title", "A", "source", "jsonassert/rules", "subtype", "script")));
        assertEquals(List.of("source: rawvalue cards have no name-source (write source: rawvalue)"),
                CardCodec.validate(Map.of("title", "A", "source", "rawvalue/x", "subtype", "json")));
        Card check = new Card("check", "Check", null, "jsonassert", "script", null, "", "", null, null,
                null, null, null, null, "assert x == 1", null, null);
        assertEquals("""
                -------------------
                title: Check
                source: jsonassert
                subtype: script
                timeout: 2000
                -------------------
                ```jsonassert
                assert x == 1
                ```
                """, CardCodec.render(check));
        Card noType = card("draft", "", "", "{}");
        FormatException e = assertThrows(FormatException.class,
                () -> FrameCodec.write(new Frame("Main", List.of(new Step(1, List.of(noType))))));
        assertEquals("step 1 \"Title of draft\": source: required ({type-source}/{name-source}, or rawvalue)", e.getMessage());
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
                new Step(1, List.of(card("getData", "rawvalue", "", "{}"))),
                new Step(2, List.of(card("getData", "rawvalue", "", "{}")))));
        FormatException e = assertThrows(FormatException.class, () -> FrameCodec.write(duplicate));
        assertEquals("var-name \"getData\" is used twice (step 1 \"Title of getData\" and step 2 \"Title of getData\")",
                e.getMessage());

        Frame lossy = new Frame("Main", List.of(new Step(1, List.of(card("getHTTPData", "rawvalue", "", "{}")))));
        e = assertThrows(FormatException.class, () -> FrameCodec.write(lossy));
        assertEquals("var-name \"getHTTPData\" cannot be stored; use \"getHttpdata\"", e.getMessage());

        Card badTimeout = new Card("slow", "Slow", null, "rawvalue", "json", null, "", "", null, null, 50, null, null, null, "", null, null);
        e = assertThrows(FormatException.class,
                () -> FrameCodec.write(new Frame("Main", List.of(new Step(1, List.of(badTimeout))))));
        assertEquals("step 1 \"Slow\": timeout: must be >= 100", e.getMessage());
    }

    @Test
    void frameWriteNumbersStepsAndCardsByPositionAndDerivesMissingVarNames() {
        Card untitledVar = new Card(null, "Echo payload", null, "rawvalue", "json", null, null, null, null, null, null, null, null, null,
                "{}", "secret", null);
        FrameCodec.Written written = FrameCodec.write(new Frame("My Flow", List.of(
                new Step(7, List.of(card("first", "rawvalue", "", "1"), untitledVar)))));
        assertEquals("my-flow", written.dir());
        Map<String, String> files = written.files().stream()
                .collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(List.of("my-flow/step-1/echo-payload.md", "my-flow/step-1/echo-payload.private.md",
                        "my-flow/step-1/first.md", "my-flow/step-1/flow.md"),
                files.keySet().stream().sorted().toList());
        assertEquals("-------------------\n-------------------\nfirst\necho-payload\n", files.get("my-flow/step-1/flow.md"),
                "the step sequence maps the card files in order");
        assertEquals("-------------------\n-------------------\nsecret\n", files.get("my-flow/step-1/echo-payload.private.md"));
    }

    @Test
    void varNameFlowIsReservedForTheSequenceFile() {
        FormatException e = assertThrows(FormatException.class, () -> FrameCodec.write(new Frame("Main",
                List.of(new Step(1, List.of(card("flow", "rawvalue", "", "{}")))))));
        assertEquals("var-name \"flow\" is reserved by the step sequence file; use another name", e.getMessage());
    }

    @Test
    void frameReadReportsInvalidFilesAndOrphanPrivates() {
        List<ProjectFile> files = List.of(
                new ProjectFile("main/step-1/a.md", "-------------------\nsource: rawvalue\nsubtype: json\n-------------------\n"),
                new ProjectFile("main/step-1/b.private.md", "-------------------\n-------------------\nx\n"),
                new ProjectFile("main/step-1/c.md", "-------------------\ntitle: C\n-------------------\n"),
                new ProjectFile("main/notes.md", "x"));
        FramesResponse read = FrameCodec.read(files);
        assertEquals(List.of(
                "main/step-1/a.md: title: required",
                "main/step-1/c.md: source: required ({type-source}/{name-source}, or rawvalue)",
                "main/notes.md: path must be {frame}/step-{n}/{var-name}.md",
                "main/step-1/b: private data without a card (main/step-1/b.md missing)"), read.errors());
        assertEquals(List.of(), read.frames());
    }

    @Test
    void flowMismatchIsReported() {
        List<ProjectFile> files = List.of(
                new ProjectFile("main/step-1/a.md", "-------------------\ntitle: A\nsource: rawvalue\nsubtype: json\n-------------------\n"),
                new ProjectFile("main/step-1/b.md", "-------------------\ntitle: B\nsource: rawvalue\nsubtype: json\n-------------------\n"),
                new ProjectFile("main/step-1/flow.md", "-------------------\n-------------------\nb\nghost\n"));
        FramesResponse read = FrameCodec.read(files);
        assertEquals(List.of(
                "main/step-1/flow.md: ghost.md is listed but the card file is missing",
                "main/step-1/a.md: not listed in flow.md"), read.errors());
        assertEquals(List.of("b", "a"), read.frames().getFirst().steps().getFirst().cards().stream()
                .map(Card::varName).toList(), "listed cards first, unlisted appended");
    }

    @Test
    void frameReadSortsStepsNumericallyAndCardsByFlow() {
        Function<String, String> md = title -> "-------------------\ntitle: " + title + "\nsource: rawvalue\nsubtype: json\n-------------------\n";
        List<ProjectFile> files = List.of(
                new ProjectFile("main/step-10/z.md", md.apply("Z")),
                new ProjectFile("main/step-10/flow.md", "-------------------\n-------------------\nz\n"),
                new ProjectFile("main/step-2/b.md", md.apply("B")),
                new ProjectFile("main/step-2/c.md", md.apply("C")),
                new ProjectFile("main/step-2/flow.md", "-------------------\n-------------------\nc\nb\n"),
                new ProjectFile("main/step-2/c.cache.md", CardCodec.renderResult(new CardRun("error", "boom", "", "1s", null))));
        FramesResponse read = FrameCodec.read(files);
        assertEquals(List.of(), read.errors());
        Frame frame = read.frames().getFirst();
        assertEquals(List.of(1, 2), frame.steps().stream().map(Step::number).toList());
        assertEquals(List.of("c", "b"), frame.steps().getFirst().cards().stream().map(Card::varName).toList());
        assertEquals("error", frame.steps().getFirst().cards().getFirst().lastRun().status());
        assertEquals("z", frame.steps().get(1).cards().getFirst().varName());
    }

}
