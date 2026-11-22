package com.testframe.server.service;

import com.testframe.server.controller.ApiExceptionHandler;
import com.testframe.server.controller.FrameController;
import com.testframe.server.controller.SourceController;
import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardRun;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
import com.testframe.server.dto.Source;
import com.testframe.server.dto.Step;
import com.testframe.server.openapi.OpenApiService;
import com.testframe.server.store.ProjectFileStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class FrameServiceTest {

    @TempDir
    Path root;

    private Card card(String varName, String sourceType, String sourceName, String code) {
        return new Card(varName, varName, null, sourceType, "mongo".equals(sourceType) ? "find" : "rawvalue".equals(sourceType) ? "json" : null, sourceName, "", null, null,
                null, null, null, null, code, null, null);
    }

    private static OpenApiService offline(SourceService sources) {
        return new OpenApiService(sources, url -> {
            throw new IOException("offline");
        });
    }

    @Test
    void savesAndLoadsAFrameWithPrivateDataAndResults() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        SourceService sources = new SourceService(store);
        FrameService frames = new FrameService(store, sources, offline(sources));
        sources.save("demo", List.of(new Source("mongo", "db", "mongodb://localhost/x", "")));

        frames.save("demo", new Frame("Main Flow", List.of(new Step(1, List.of(
                card("getAll", "mongo", "db", "{\"collection\": \"x\"}").withPrivateData("token: t"),
                card("payload", "rawvalue", "", "{}"))))));
        frames.saveResult("demo", "Main Flow", 1, "getAll", new CardRun("success", "ok", "[]", "0.1s", "2026-11-21T00:00:00Z"));

        Path card = root.resolve("demo/testframe/frames/main-flow/step-1/get-all.md");
        assertTrue(Files.readString(card).endsWith("-------------------\n```json\n{\"collection\": \"x\"}\n```\n"),
                "the card holds its own code");
        assertTrue(Files.exists(card.resolveSibling("get-all.private.md")));
        assertTrue(Files.exists(card.resolveSibling("get-all.cache.md")));
        assertEquals("-------------------\n-------------------\nget-all\npayload\n",
                Files.readString(card.resolveSibling("flow.md")), "the step flow maps the card sequence");

        FramesResponse loaded = frames.load("demo");
        assertEquals(List.of(), loaded.errors());
        Card getAll = loaded.frames().getFirst().steps().getFirst().cards().getFirst();
        assertEquals("{\"collection\": \"x\"}", getAll.code());
        assertEquals("find", getAll.subtype());
        assertEquals("token: t", getAll.privateData());
        assertEquals("success", getAll.lastRun().status());
        assertEquals("mongodb://localhost/x", sources.baseUrl("demo", "mongo", "db"));
    }

    @Test
    void invalidDataIsA400WithStatusAndMessage() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        SourceService sources = new SourceService(store);
        MockMvc mvc = MockMvcBuilders
                .standaloneSetup(new FrameController(new FrameService(store, sources, offline(sources))),
                        new SourceController(sources, offline(sources)))
                .setControllerAdvice(new ApiExceptionHandler())
                .build();

        mvc.perform(post("/api/v2/frames").contentType("application/json").content("""
                        {"project": "demo", "frame": {"name": "main", "steps": [{"number": 1, "cards": [
                          {"varName": "same", "title": "A", "sourceType": "rawvalue", "subtype": "json", "code": "{}"},
                          {"varName": "same", "title": "B", "sourceType": "rawvalue", "subtype": "json", "code": "{}"}]}]}}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.message").value("var-name \"same\" is used twice (step 1 \"A\" and step 1 \"B\")"));

        mvc.perform(post("/api/v2/frames").contentType("application/json")
                        .content("{\"project\": \"../../etc\", \"frame\": {\"name\": \"main\", \"steps\": []}}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));

        mvc.perform(post("/api/v2/sources").contentType("application/json")
                        .content("{\"project\": \"demo\", \"sources\": [{\"typeSource\": \"mongo\", \"name\": \"../x\"}]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Source 1 (../x): name: use letters, digits, dot, hyphen and underscore"));

        // Phase 2: the code rules per source type are enforced on both saves
        mvc.perform(post("/api/v2/frames").contentType("application/json").content("""
                        {"project": "demo", "frame": {"name": "main", "steps": [{"number": 1, "cards": [
                          {"varName": "q", "title": "Q", "sourceType": "mongo", "subtype": "aggregation", "sourceName": "db",
                           "code": "{\\"collection\\": \\"x\\", \\"pipeline\\": [{\\"$merge\\": \\"y\\"}]}"}]}]}}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("step 1 \"Q\": code: write stage \"$merge\" is not allowed (mongo cards are read-only)"));

        // every card declares its type-source and a subtype when the type has them
        mvc.perform(post("/api/v2/frames").contentType("application/json").content("""
                        {"project": "demo", "frame": {"name": "main", "steps": [{"number": 1, "cards": [
                          {"varName": "a", "title": "A", "sourceType": "", "code": "{}"},
                          {"varName": "b", "title": "B", "sourceType": "mongo", "sourceName": "db", "code": ""}]}]}}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("step 1 \"A\": source: required ({type-source}/{name-source}, or rawvalue); "
                        + "step 1 \"B\": subtype: required for mongo (find, aggregation)"));

        mvc.perform(post("/api/v2/sources").contentType("application/json").content("""
                        {"project": "demo", "sources": [{"typeSource": "jsonassert", "name": "rules"}]}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Source 1 (rules): typeSource: jsonassert has no named sources (its cards hold their own code)"));

        mvc.perform(get("/api/v2/frames/demo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.frames").isEmpty())
                .andExpect(jsonPath("$.errors").isEmpty());
    }
}
