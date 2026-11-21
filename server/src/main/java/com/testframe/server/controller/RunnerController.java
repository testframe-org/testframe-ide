package com.testframe.server.controller;

import com.testframe.server.runner.MongoScriptRunner;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

    private static final Pattern BASE_URL = Pattern.compile("(?m)^base-url:\\s*(\\S.*?)\\s*$");

    private final MongoScriptRunner mongo;
    private final ProjectFileStore store;

    public RunnerController(MongoScriptRunner mongo, ProjectFileStore store) {
        this.mongo = mongo;
        this.store = store;
    }

    @PostMapping(value = "/mongo", produces = MediaType.APPLICATION_JSON_VALUE)
    public String mongo(@RequestBody MongoRunRequest request) {
        if (blank(request.project()) || blank(request.source()) || blank(request.script())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "project, source and script are required");
        }
        String uri = baseUrl(request.project(), "mongo/" + request.source() + ".md");
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

    /** base-url from the source file's frontmatter (the part before the body separator). */
    private String baseUrl(String project, String sourceFile) {
        String content;
        try {
            content = store.read(project, "testframe/sources", sourceFile)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                            "Source file not found: sources/" + sourceFile + " (save the sources first)"));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        int body = content.indexOf("--------body----------");
        Matcher m = BASE_URL.matcher(body >= 0 ? content.substring(0, body) : content);
        if (!m.find()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sources/" + sourceFile + " has no base-url");
        }
        return m.group(1);
    }

    /** Errors carry their reason in the body so the editor can show it next to the card. */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> error(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("status", e.getStatusCode().value(), "message", String.valueOf(e.getReason())));
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
