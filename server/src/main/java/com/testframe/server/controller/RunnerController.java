package com.testframe.server.controller;

import com.testframe.server.runner.MongoScriptRunner;
import com.testframe.server.service.SourceService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;

/** Executes source scripts on behalf of the editor (the browser cannot reach databases). */
@RestController
@RequestMapping("/api/v2/run")
public class RunnerController {

    /**
     * {@code project} + {@code source}: the mongo source whose file holds the connection
     * ({@code sources/mongo/{source}.md}, frontmatter {@code base-url}); {@code script}: e.g.
     * db.products.find({ ativo: true }). Nothing comes from the server's own configuration.
     */
    public record MongoRunRequest(String project, String source, String script, Long timeoutMs) {
    }

    private final MongoScriptRunner mongo;
    private final SourceService sources;

    public RunnerController(MongoScriptRunner mongo, SourceService sources) {
        this.mongo = mongo;
        this.sources = sources;
    }

    @PostMapping(value = "/mongo", produces = MediaType.APPLICATION_JSON_VALUE)
    public String mongo(@RequestBody MongoRunRequest request) throws IOException {
        if (blank(request.project()) || blank(request.source()) || blank(request.script())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "project, source and script are required");
        }
        String uri = sources.baseUrl(request.project(), "mongo", request.source());
        long timeout = request.timeoutMs() == null ? 5000 : Math.clamp(request.timeoutMs(), 100, 120_000);
        try {
            return mongo.run(uri, request.script(), timeout);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage(), e);
        } catch (RuntimeException e) {
            // connection / server errors (e.g. MongoTimeoutException when mongod is down)
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, e.getClass().getSimpleName() + ": " + e.getMessage(), e);
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
