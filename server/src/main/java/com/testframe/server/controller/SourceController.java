package com.testframe.server.controller;

import com.testframe.server.dto.SaveSourcesRequest;
import com.testframe.server.dto.Source;
import com.testframe.server.dto.SourcesResponse;
import com.testframe.server.format.Names;
import com.testframe.server.openapi.OpenApiService;
import com.testframe.server.openapi.OpenApiSpec;
import com.testframe.server.service.SourceService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v2/sources")
public class SourceController {

    private final SourceService sources;
    private final OpenApiService openApi;

    public SourceController(SourceService sources, OpenApiService openApi) {
        this.sources = sources;
        this.openApi = openApi;
    }

    /**
     * Saves the sent sources; each saved openapi source then rewrites its operations cache
     * ({@code {name}.cache.md}). A spec that cannot be read does not fail the save: the reason
     * comes back in {@code warnings}.
     */
    @PostMapping
    public Map<String, Object> save(@RequestBody SaveSourcesRequest request) throws IOException {
        Map<String, Object> saved = new LinkedHashMap<>(sources.save(request.project(), request.sources()));
        List<String> warnings = new ArrayList<>();
        for (Source source : request.sources() == null ? List.<Source>of() : request.sources()) {
            if (OpenApiService.TYPE.equals(source.typeSource()) && !Names.isBlank(source.baseUrl())) {
                try {
                    openApi.refresh(request.project(), source.name());
                } catch (ResponseStatusException e) {
                    warnings.add("openapi/" + source.name() + ": " + e.getReason());
                }
            }
        }
        saved.put("warnings", warnings);
        return saved;
    }

    @GetMapping("/{project}")
    public SourcesResponse load(@PathVariable String project) throws IOException {
        return sources.load(project);
    }

    /**
     * The fixed operations an openapi source offers to its cards, read from its cache
     * ({@code {name}.cache.md}; fetched once from the spec at base-url when missing):
     * {@code {specUrl, baseUrl, fetchedAt, operations: [{method, path, summary}]}}.
     */
    @GetMapping("/openapi/{name}/operations")
    public OpenApiSpec operations(@PathVariable String name, @RequestParam String project) throws IOException {
        return openApi.spec(project, name);
    }

    /** Deletes one source and its private/cache files: 404 when missing, 409 while cards still use it. */
    @DeleteMapping("/{type}/{name}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String type, @PathVariable String name, @RequestParam String project)
            throws IOException {
        sources.delete(project, type, name);
    }
}
