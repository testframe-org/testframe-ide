package com.testframe.server.service;

import com.testframe.server.controller.ApiExceptionHandler;
import com.testframe.server.controller.SourceController;
import com.testframe.server.dto.Card;
import com.testframe.server.dto.Frame;
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

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** {@code DELETE /api/v2/sources/{type}/{name}}: files removed, 404, 409 with the referencing cards, no traversal. */
class SourceDeleteTest {

    @TempDir
    Path root;

    private final ProjectFileStore store() {
        return new ProjectFileStore(root.toString());
    }

    private MockMvc mvc(SourceService sources) {
        OpenApiService openApi = new OpenApiService(sources, url -> {
            throw new IOException("offline");
        });
        return MockMvcBuilders.standaloneSetup(new SourceController(sources, openApi))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void deletesTheSourceAndItsSiblingsOnly() throws Exception {
        SourceService sources = new SourceService(store());
        sources.save("demo", List.of(new Source("mongo", "db", "mongodb://localhost/x", "secret: 1"),
                new Source("mongo", "other", "mongodb://localhost/y", "")));
        Path dir = root.resolve("demo/testframe/sources/mongo");
        Files.writeString(dir.resolve("db.cache.md"), "x");
        assertTrue(Files.exists(dir.resolve("db.private.md")));

        mvc(sources).perform(delete("/api/v2/sources/mongo/db").param("project", "demo"))
                .andExpect(status().isNoContent());

        assertFalse(Files.exists(dir.resolve("db.md")));
        assertFalse(Files.exists(dir.resolve("db.private.md")));
        assertFalse(Files.exists(dir.resolve("db.cache.md")));
        assertTrue(Files.exists(dir.resolve("other.md")));

        mvc(sources).perform(delete("/api/v2/sources/mongo/other").param("project", "demo"))
                .andExpect(status().isNoContent());
        assertFalse(Files.exists(dir), "the emptied type folder goes too");
        assertTrue(Files.isDirectory(root.resolve("demo/testframe")));
    }

    @Test
    void missingSourceIs404() throws Exception {
        SourceService sources = new SourceService(store());
        mvc(sources).perform(delete("/api/v2/sources/mongo/nope").param("project", "demo"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404));
    }

    @Test
    void sourceUsedByCardsIs409AndStaysOnDisk() throws Exception {
        ProjectFileStore store = store();
        SourceService sources = new SourceService(store);
        FrameService frames = new FrameService(store, sources, new OpenApiService(sources, url -> {
            throw new IOException("offline");
        }));
        sources.save("demo", List.of(new Source("mongo", "db", "mongodb://localhost/x", "")));
        frames.save("demo", new Frame("Main", List.of(new Step(1, List.of(
                new Card("getAll", "getAll", null, "mongo", "find", "x", "db", "", null, null,
                        null, null, null, null, "{\n  \"filter\": {}\n}", null, null))))));

        mvc(sources).perform(delete("/api/v2/sources/mongo/db").param("project", "demo"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("main/step-1/getAll")));
        assertTrue(Files.exists(root.resolve("demo/testframe/sources/mongo/db.md")));
    }

    @Test
    void invalidTypeOrNameIs400AndNothingEscapes() throws Exception {
        SourceService sources = new SourceService(store());
        Path outside = root.resolve("demo/testframe/keep.md");
        Files.createDirectories(outside.getParent());
        Files.writeString(outside, "keep");
        MockMvc mvc = mvc(sources);

        mvc.perform(delete("/api/v2/sources/nope/db").param("project", "demo")).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/v2/sources/rawvalue/db").param("project", "demo")).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/v2/sources/mongo/..").param("project", "demo")).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/v2/sources/mongo/a.cache").param("project", "demo")).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/v2/sources/mongo/x").param("project", "demo")).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/v2/sources/mongo/db").param("project", "../demo")).andExpect(status().is4xxClientError());
        assertTrue(Files.exists(outside));
    }
}
