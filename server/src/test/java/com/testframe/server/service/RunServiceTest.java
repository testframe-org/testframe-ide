package com.testframe.server.service;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardResult;
import com.testframe.server.dto.FrameRunResponse;
import com.testframe.server.dto.RunCardRequest;
import com.testframe.server.dto.RunFrameRequest;
import com.testframe.server.dto.Source;
import com.testframe.server.dto.Step;
import com.testframe.server.openapi.OpenApiService;
import com.testframe.server.runner.HttpRequestRunner;
import com.testframe.server.runner.MongoRunner;
import com.testframe.server.store.ProjectFileStore;
import com.sun.net.httpserver.HttpServer;
import io.github.jsonassert.JsonataAssertionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The server-side card runner: {@code {{bindings}}}, request cards over real HTTP (against an
 * in-test echo server), the mongo rules reused without a database, assert cards over the
 * published variables, result-card rewriting and the first-error stop.
 */
class RunServiceTest {

    @TempDir
    Path root;

    private SourceService sources;
    private RunService runs;
    private HttpServer echoServer;
    private String echoBase;

    private static Card card(String varName, String sourceType, String code) {
        return new Card(varName, varName, null, sourceType, "rawvalue".equals(sourceType) ? "json" : null, null, "", "", null, null,
                null, null, null, null, code, null, null);
    }

    private static Card request(String varName, String endpoint) {
        return new Card(varName, varName, null, "openapi", "restapi", null, "", endpoint, null, null,
                null, null, null, null, "", null, null);
    }

    private static Card conditional(String varName, String code) {
        return assertCard(varName, code).withSubtype("conditional");
    }

    private static Card assertCard(String varName, String code) {
        return new Card(varName, varName, null, "jsonassert", "script", null, "", "", null, null,
                null, null, null, null, code, null, null);
    }

    private static Card mongoCard(String varName, String sourceName, String code) {
        return new Card(varName, varName, null, "mongo", "find", "x", sourceName, "", null, null,
                null, null, null, null, code, null, null);
    }

    @BeforeEach
    void startEchoServer() throws IOException {
        sources = new SourceService(new ProjectFileStore(root.toString()));
        // the openapi spec "served" for every source: its servers[0] is the in-test echo server
        OpenApiService openApi = new OpenApiService(sources, url -> """
                {"openapi": "3.0.1", "servers": [{"url": "%s"}],
                 "paths": {"/api/v2/echo": {"post": {"operationId": "echo", "summary": "Echo"}}}}
                """.formatted(echoBase));
        runs = new RunService(new MongoRunner(), sources, openApi, new JsonataAssertionService(),
                new HttpRequestRunner(HttpClient.newHttpClient()), JsonMapper.builder().build());
        echoServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        echoServer.createContext("/api/v2/echo", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            byte[] out = ("{\"request_id\":\"REQ-1\",\"status\":\"PROCESSADO\",\"echo\":"
                    + (body.isEmpty() ? "null" : body) + "}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(201, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        echoServer.start();
        echoBase = "http://127.0.0.1:" + echoServer.getAddress().getPort();
    }

    @AfterEach
    void stopEchoServer() {
        echoServer.stop(0);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    private FrameRunResponse run(Step... steps) {
        return runs.runFrame(new RunFrameRequest("demo", "flow", List.of(steps)), echoBase);
    }

    @Test
    void jsonCardsPublishBindingsForLaterCards() {
        FrameRunResponse r = run(new Step(1, List.of(
                card("seed", "rawvalue", "{\"a\": {\"b\": 7}}"),
                card("copy", "rawvalue", "{\"x\": \"{{seed.a.b}}\", \"kept\": \"{{missing.path}}\"}"))));

        assertEquals(List.of("success", "success"), r.results().stream().map(CardResult::status).toList());
        assertEquals("[Step 1] copy: OK", r.results().get(1).text());
        Map<String, Object> copy = asMap(r.vars().get("copy"));
        assertEquals(7, copy.get("x"));
        assertEquals("{{missing.path}}", copy.get("kept"), "unresolved templates stay as written");
    }

    @Test
    void requestCardRunsHttpPublishesAndFeedsTheNextJsonCard() {
        FrameRunResponse r = run(new Step(1, List.of(
                card("seed", "rawvalue", "{\"n\": 2}"),
                card("payload", "rawvalue", "{\"v\": \"{{seed.n}}\"}"),
                request("send", "POST /api/v2/echo"),
                card("out", "rawvalue", "{}"),
                assertCard("check", "assert send.echo.v == 2"))));

        assertEquals(List.of("success", "success", "success", "success", "success"),
                r.results().stream().map(CardResult::status).toList());
        // the request body was the payload card after resolving the bindings
        assertEquals(2, asMap(asMap(r.vars().get("send")).get("echo")).get("v"));
        // the JSON result card after the request is rewritten, and the rewrite is sent back
        CardResult out = r.results().get(3);
        assertNotNull(out.code(), "the rewritten body comes back for the editor to mirror");
        assertTrue(out.code().contains("PROCESSADO"));
        assertEquals("PROCESSADO", asMap(r.vars().get("out")).get("status"));
        assertTrue((Boolean) asMap(r.vars().get("check")).get("passed"));
    }

    @Test
    void openapiCardsGoToTheBaseOfTheirSourceSpec() throws IOException {
        sources.save("demo", List.of(new Source("openapi", "echo-api", "http://spec.invalid/openapi.json", "")));
        FrameRunResponse r = runs.runFrame(new RunFrameRequest("demo", "flow", List.of(new Step(1, List.of(
                request("send", "POST /api/v2/echo").withSourceName("echo-api"))))), "http://framework.invalid");
        assertEquals("success", r.results().getFirst().status(), r.results().getFirst().text());
        assertTrue(Files.exists(root.resolve("demo/testframe/sources/openapi/echo-api.cache.md")), "the spec was cached");

        // the operationId is the identity: a stale endpoint follows the spec's operation
        FrameRunResponse moved = runs.runFrame(new RunFrameRequest("demo", "flow", List.of(new Step(1, List.of(
                request("send", "POST /api/v1/old-echo").withSourceName("echo-api").withOpenapiId("echo"))))), "http://framework.invalid");
        assertEquals("success", moved.results().getFirst().status(), moved.results().getFirst().text());
        FrameRunResponse unknownId = run(new Step(1, List.of(
                request("send", "POST /api/v2/echo").withSourceName("echo-api").withOpenapiId("gone"))));
        assertEquals("error", unknownId.results().getFirst().status());
        assertTrue(unknownId.results().getFirst().text().contains("openapi-id \"gone\""));

        FrameRunResponse missing = run(new Step(1, List.of(request("send", "POST /api/v2/echo").withSourceName("nope"))));
        assertEquals("error", missing.results().getFirst().status());
        assertTrue(missing.results().getFirst().text().contains("404"), missing.results().getFirst().text());
    }

    @Test
    void absoluteUrlsPassThroughAndRelativeOnesUseTheServerBaseUrl() {
        assertEquals(echoBase + "/api/v2/echo", HttpRequestRunner.resolveUrl(echoBase, "/api/v2/echo"));
        assertEquals("http://other.host:9/x", HttpRequestRunner.resolveUrl(echoBase, "http://other.host:9/x"));
    }

    @Test
    void requestFailureStopsTheRunAtTheFirstErrorCard() {
        echoServer.createContext("/boom", exchange -> {
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        FrameRunResponse r = run(new Step(1, List.of(
                request("bad", "POST /boom"),
                card("never", "rawvalue", "{}"))));

        assertEquals(1, r.results().size(), "the run stops at the first error card");
        assertEquals("error", r.results().getFirst().status());
        assertTrue(r.results().getFirst().text().contains("HTTP 500"));
        assertFalse(r.vars().containsKey("never"));
    }

    @Test
    void networkErrorIsReportedOnTheCard() {
        FrameRunResponse r = run(new Step(1, List.of(
                request("down", "POST http://127.0.0.1:1/api/v2/echo"))));

        assertEquals("error", r.results().getFirst().status());
        assertTrue(r.results().getFirst().output().contains("ConnectException"),
                "the connection failure is the card's output: " + r.results().getFirst().output());
    }

    @Test
    void assertCardOverPublishedVarsFailsAndStopsTheRun() {
        FrameRunResponse r = run(new Step(1, List.of(
                card("seed", "rawvalue", "{\"items\": [1, 2]}"),
                assertCard("check", "assert $count(items) == 5"),
                card("never", "rawvalue", "{}"))));

        assertEquals(2, r.results().size());
        assertEquals("error", r.results().get(1).status());
        assertTrue(r.results().get(1).text().contains("FAILED assertion"));
        assertFalse(r.vars().containsKey("never"));
    }

    @Test
    void invalidCodeFailsTheCardBeforeItRuns() {
        FrameRunResponse r = run(new Step(1, List.of(
                mongoCard("wipe", "db", "{\"filter\": {}, \"remove\": true}"),
                card("never", "rawvalue", "{}"))));

        assertEquals(1, r.results().size());
        assertEquals("error", r.results().getFirst().status());
        assertTrue(r.results().getFirst().text().contains("unknown key \"remove\""));
        assertTrue(r.results().getFirst().output().contains("find accepts"));
    }

    @Test
    void mongoCardsFailCleanlyWithoutSourceOrSavedFile() throws IOException {
        FrameRunResponse noSource = run(new Step(1, List.of(mongoCard("q", "", "{}"))));
        assertEquals("error", noSource.results().getFirst().status());
        assertTrue(noSource.results().getFirst().text().contains("no mongo source"));

        FrameRunResponse missingFile = run(new Step(1, List.of(mongoCard("q", "db", "{}"))));
        assertEquals("error", missingFile.results().getFirst().status(),
                "the connection comes from the saved source file only");
        assertTrue(missingFile.results().getFirst().text().contains("not found"),
                missingFile.results().getFirst().text());

        // with a saved source, the read-only rules still apply before anything connects
        sources.save("demo", List.of(new Source("mongo", "db", "mongodb://127.0.0.1:1/demo", "")));
        FrameRunResponse write = run(new Step(1, List.of(mongoCard("q", "db", "{}")
                .withSubtype("aggregation").withCode("{\"pipeline\": [{\"$out\": \"y\"}]}"))));
        assertEquals("error", write.results().getFirst().status());
        assertTrue(write.results().getFirst().text().contains("$out"), write.results().getFirst().text());
    }

    @Test
    void unreachableMongoIsReportedClearlyOnTheCard() throws IOException {
        // the source saves fine; the database behind its base-url simply is not there
        sources.save("demo", List.of(new Source("mongo", "down", "mongodb://127.0.0.1:1/demo", "")));
        FrameRunResponse r = run(new Step(1, List.of(mongoCard("q", "down", "{}"))));
        CardResult card = r.results().getFirst();
        assertEquals("error", card.status());
        // the driver names the real cause (socket open refused) on the card, and the run stops there
        assertTrue(card.text().contains("Connection refused") && card.output().contains("Connection refused"),
                "the driver failure is named on the card: " + card.text() + " / " + card.output());
    }

    @Test
    void cardsRunInSentStepAndArrayOrder() {
        // the runner follows the sent order (the editor's flow order), not the step numbers
        FrameRunResponse r = run(
                new Step(2, List.of(card("stepTwoB", "rawvalue", "{}"), card("stepTwoA", "rawvalue", "{}"))),
                new Step(1, List.of(card("one", "rawvalue", "{}"))));
        assertEquals(List.of("stepTwoB", "stepTwoA", "one"),
                r.results().stream().map(CardResult::varName).toList());
    }

    @Test
    void simulatedCardsStaySuccessfulAndTheForceFailMarkerForcesAnError() {
        FrameRunResponse r = run(new Step(1, List.of(
                card("plain", "rawvalue", "not json"),
                card("forced", "rawvalue", "{\"force_fail\": 1}"))));

        assertEquals("success", r.results().getFirst().status());
        assertTrue(r.results().getFirst().output().startsWith("Simulated"));
        assertFalse(r.vars().containsKey("plain"));
        assertEquals("error", r.results().get(1).status(), "the run stops at the force_fail card");
        assertEquals(2, r.results().size());
    }

    @Test
    void requestWithoutEndpointStaysSimulated() {
        FrameRunResponse r = run(new Step(1, List.of(request("nonep", ""))));
        assertEquals("success", r.results().getFirst().status());
        assertTrue(r.results().getFirst().output().startsWith("Simulated"));
        assertNull(r.vars().get("nonep"));
    }

    @Test
    void singleCardRunUsesExplicitVarsAndPayload() {
        var r = runs.runCard(new RunCardRequest("demo", 2, request("solo", "POST /api/v2/echo"),
                Map.of("seed", Map.of("x", 5)), "{\"v\": \"{{seed.x}}\"}",
                new RunCardRequest.ResultCard("out", "{}")), echoBase);

        assertEquals("success", r.result().status());
        assertTrue(r.result().text().startsWith("[Step 2] solo: HTTP 201"), r.result().text());
        assertEquals(5, asMap(asMap(r.vars().get("solo")).get("echo")).get("v"));
        assertNotNull(r.vars().get("out"), "the result card variable is published for the editor");
        assertEquals(5, asMap(asMap(r.vars().get("out")).get("echo")).get("v"));
    }

    @Test
    void scriptCardsPublishTheirLastExpression() {
        FrameRunResponse r = run(new Step(1, List.of(
                card("seed", "rawvalue", "{\"items\": [{\"price\": 5, \"name\": \"a\"}, {\"price\": 50, \"name\": \"b\"}]}"),
                assertCard("expensive", "assert $count(seed.items) == 2\n// filter + map\nseed.items[price > 10].name"))));
        assertEquals(List.of("success", "success"), r.results().stream().map(CardResult::status).toList());
        assertEquals("b", r.vars().get("expensive"), "the value of the last plain expression is the card's variable");
    }

    @Test
    void falseConditionalSkipsTheRestOfTheStepAndTheRunGoesOn() {
        FrameRunResponse r = run(
                new Step(1, List.of(
                        card("seed", "rawvalue", "{\"n\": 0}"),
                        conditional("hasItems", "seed.n > 0"),
                        card("never", "rawvalue", "{}"),
                        assertCard("neverChecked", "assert 1 == 2"))),
                new Step(2, List.of(card("next", "rawvalue", "{\"ok\": true}"))));
        assertEquals(List.of("success", "success", "skipped", "skipped", "success"),
                r.results().stream().map(CardResult::status).toList());
        assertEquals("[Step 1] hasItems: condition false: skipping rest of step 1", r.results().get(1).text());
        assertEquals(Boolean.FALSE, r.vars().get("hasItems"));
        assertFalse(r.vars().containsKey("never"));
        assertTrue(r.vars().containsKey("next"), "the next step runs");
    }

    @Test
    void trueConditionalContinuesAndNonBooleanIsAnError() {
        FrameRunResponse ok = run(new Step(1, List.of(
                card("seed", "rawvalue", "{\"n\": 3}"),
                conditional("hasItems", "seed.n > 0"),
                card("after", "rawvalue", "{}"))));
        assertEquals(List.of("success", "success", "success"), ok.results().stream().map(CardResult::status).toList());
        assertEquals("[Step 1] hasItems: condition true", ok.results().get(1).text());

        FrameRunResponse bad = run(new Step(1, List.of(
                card("seed", "rawvalue", "{\"n\": 3}"),
                conditional("notBool", "seed.n"),
                card("after", "rawvalue", "{}"))));
        assertEquals(List.of("success", "error"), bad.results().stream().map(CardResult::status).toList());
        assertTrue(bad.results().get(1).text().contains("the condition must be boolean, got 3"), bad.results().get(1).text());
    }
}
