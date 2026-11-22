package com.testframe.server.controller;

import com.testframe.server.dto.SaveSourcesRequest;
import com.testframe.server.dto.SourcesResponse;
import com.testframe.server.service.SourceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/v2/sources")
public class SourceController {

    private final SourceService sources;

    public SourceController(SourceService sources) {
        this.sources = sources;
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody SaveSourcesRequest request) throws IOException {
        return sources.save(request.project(), request.sources());
    }

    @GetMapping("/{project}")
    public SourcesResponse load(@PathVariable String project) throws IOException {
        return new SourcesResponse(sources.load(project));
    }
}
