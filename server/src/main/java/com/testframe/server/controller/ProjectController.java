package com.testframe.server.controller;

import com.testframe.server.store.ProjectFileStore;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/v2/projects")
public class ProjectController {

    private final ProjectFileStore store;

    public ProjectController(ProjectFileStore store) {
        this.store = store;
    }

    /** Projects under the projects dir (folders with testframe/), most recently changed first. */
    @GetMapping
    public List<ProjectFileStore.ProjectSummary> list() throws IOException {
        return store.listProjects();
    }
}
