package com.testframe.server.controller;

import com.testframe.server.dto.SaveFramesRequest;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/v2/frames")
public class FrameController {

    private final ProjectFileStore store;

    public FrameController(ProjectFileStore store) {
        this.store = store;
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody SaveFramesRequest request) throws IOException {
        return store.save(request.project(), "testframe/frames", request.files());
    }

    @GetMapping("/{project}")
    public Map<String, Object> load(@PathVariable String project) throws IOException {
        return store.load(project, "testframe/frames");
    }
}
