package com.testframe.server.controller;

import com.testframe.server.dto.FrameFile;
import com.testframe.server.dto.SaveFramesRequest;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/v2/frames")
public class FrameController {

    private final ProjectFileStore store;

    public FrameController(ProjectFileStore store) {
        this.store = store;
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody SaveFramesRequest request) throws IOException {
        List<FrameFile> files = request.files() == null ? List.of() : request.files();
        Set<String> frames = new LinkedHashSet<>();
        if (request.frame() != null && !request.frame().isBlank()) {
            frames.add(request.frame());
        }
        for (FrameFile file : files) {
            String path = file.path() == null ? "" : file.path().replace('\\', '/');
            int slash = path.indexOf('/');
            frames.add(slash > 0 ? path.substring(0, slash) : path);
        }
        return store.replace(request.project(), "testframe/frames", frames, List.of(), files);
    }

    /** {project, path, content}: path relative to frames/, e.g. main/step-1/get-data.result-data.md */
    public record SaveResultRequest(String project, String path, String content) {
    }

    @PostMapping("/results")
    public Map<String, Object> saveResult(@RequestBody SaveResultRequest request) throws IOException {
        return store.saveResult(request.project(), request.path(), request.content());
    }

    @GetMapping("/{project}")
    public Map<String, Object> load(@PathVariable String project) throws IOException {
        return store.load(project, "testframe/frames");
    }
}
