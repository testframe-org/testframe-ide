package com.testframe.server.openapi;

import com.testframe.server.controller.ApiExceptionHandler;
import com.testframe.server.controller.SourceController;
import com.testframe.server.dto.Source;
import com.testframe.server.service.SourceService;
import com.testframe.server.store.ProjectFileStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class OpenApiServiceTest {

    private static final String SPEC_URL = "http://localhost:18081/api/docs/openapi.json";

    @TempDir
    Path root;

    private SourceService sources;
    private final AtomicInteger fetches = new AtomicInteger();
    private boolean online = true;
    private OpenApiService openApi;

    @BeforeEach
    void setUp() throws IOException {
        sources = new SourceService(new ProjectFileStore(root.toString()));
        openApi = new OpenApiService(sources, url -> {
            fetches.incrementAndGet();
            if (!online) {
                throw new IOException("Connection refused");
            }
            assertEquals(SPEC_URL, url);
            return OpenApiSpecTest.PRODUCT_API;
        });
        sources.save("demo", List.of(new Source("openapi", "product-api", SPEC_URL, "")));
    }

    private Path cacheFile() {
        return root.resolve("demo/testframe/sources/openapi/product-api.cache.md");
    }

    @Test
    void theCacheIsTheSourceOfTruthOnceWritten() throws IOException {
        OpenApiSpec first = openApi.spec("demo", "product-api");
        assertEquals(1, fetches.get(), "a missing cache is fetched once");
        assertTrue(Files.exists(cacheFile()));
        assertTrue(Files.readString(root.resolve("demo/testframe/.gitignore")).contains("*.cache.md"));

        online = false;
        assertEquals(first, openApi.spec("demo", "product-api"), "later reads come from the cache file");
        assertEquals(1, fetches.get());
        assertEquals(1, sources.load("demo").sources().size(), "the cache is never read as a source");
        assertEquals(List.of(), sources.load("demo").errors());

        ResponseStatusException down = assertThrows(ResponseStatusException.class, () -> openApi.refresh("demo", "product-api"));
        assertEquals(502, down.getStatusCode().value());
        assertTrue(down.getReason().contains("Connection refused"), down.getReason());
        assertEquals(first, openApi.spec("demo", "product-api"), "a failed rewrite (source save) keeps the cache");
    }

    @Test
    void aCacheOfAnotherSpecUrlIsFetchedAgain() throws IOException {
        openApi.spec("demo", "product-api");
        Files.writeString(cacheFile(), Files.readString(cacheFile()).replace(SPEC_URL, "http://old/spec.json"));
        openApi.spec("demo", "product-api");
        assertEquals(2, fetches.get());
    }

    @Test
    void operationsEndpointAndSaveRefresh() throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new SourceController(sources, openApi))
                .setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(post("/api/v2/sources").contentType("application/json").content("""
                        {"project": "demo", "sources": [{"typeSource": "openapi", "name": "product-api",
                          "baseUrl": "%s", "privateData": ""}]}
                        """.formatted(SPEC_URL)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings").isEmpty());
        assertEquals(1, fetches.get(), "saving an openapi source fills its cache");

        mvc.perform(get("/api/v2/sources/openapi/product-api/operations").param("project", "demo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.baseUrl").value("http://localhost:18081"))
                .andExpect(jsonPath("$.operations.length()").value(4))
                .andExpect(jsonPath("$.operations[1].method").value("POST"))
                .andExpect(jsonPath("$.operations[1].path").value("/api/products"))
                .andExpect(jsonPath("$.operations[1].summary").value("Criar produto"))
                .andExpect(jsonPath("$.fetchedAt").isNotEmpty());
        assertEquals(1, fetches.get(), "the endpoint reads the cache");

        online = false;
        mvc.perform(post("/api/v2/sources").contentType("application/json").content("""
                        {"project": "demo", "sources": [{"typeSource": "openapi", "name": "product-api",
                          "baseUrl": "%s", "privateData": ""}]}
                        """.formatted(SPEC_URL)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings[0]").value(org.hamcrest.Matchers.startsWith(
                        "openapi/product-api: cannot read the OpenAPI spec at " + SPEC_URL)));
        mvc.perform(get("/api/v2/sources/openapi/missing/operations").param("project", "demo"))
                .andExpect(status().isNotFound());
    }
}
