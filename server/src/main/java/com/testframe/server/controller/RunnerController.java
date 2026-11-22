package com.testframe.server.controller;

import com.testframe.server.dto.FrameRunResponse;
import com.testframe.server.dto.RunCardRequest;
import com.testframe.server.dto.RunCardResponse;
import com.testframe.server.dto.RunFrameRequest;
import com.testframe.server.runner.MongoScriptRunner;
import com.testframe.server.service.LocalServerUrl;
import com.testframe.server.service.RunService;
import com.testframe.server.service.SourceService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;

/** Runs cards on behalf of the editor and of headless suite runs (the browser cannot reach databases). */
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
    private final RunService runs;
    private final LocalServerUrl localUrl;

    public RunnerController(MongoScriptRunner mongo, SourceService sources, RunService runs, LocalServerUrl localUrl) {
        this.mongo = mongo;
        this.sources = sources;
        this.runs = runs;
        this.localUrl = localUrl;
    }

    /** Runs one whole frame server-side ({{bindings}}, HTTP, mongo, assertions). */
    @PostMapping(value = "", produces = MediaType.APPLICATION_JSON_VALUE)
    public FrameRunResponse run(@RequestBody RunFrameRequest request) {
        return runs.runFrame(request, localUrl.get());
    }

    /** Runs one card (the editor's Run button) with the variables the editor already has. */
    @PostMapping(value = "/card", produces = MediaType.APPLICATION_JSON_VALUE)
    public RunCardResponse runCard(@RequestBody RunCardRequest request) {
        return runs.runCard(request, localUrl.get());
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
