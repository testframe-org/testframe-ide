package com.testframe.server.controller;

import com.testframe.server.dto.FrameFile;
import com.testframe.server.dto.SaveSourcesRequest;
import com.testframe.server.dto.SourceDefinition;
import com.testframe.server.dto.SourceScript;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v2/sources")
public class SourceController {

    private final ProjectFileStore store;

    public SourceController(ProjectFileStore store) {
        this.store = store;
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody SaveSourcesRequest request) throws IOException {
        List<FrameFile> files = new ArrayList<>();
        for (SourceDefinition source : request.sources()) {
            String base = "%s/%s".formatted(source.typeSource(), source.name());
            if (source.publicData() != null && !source.publicData().isBlank()) {
                files.add(new FrameFile("%s/public-data.md".formatted(base), source.publicData()));
            }
            if (source.privateData() != null && !source.privateData().isBlank()) {
                files.add(new FrameFile("%s/private-data.md".formatted(base), source.privateData()));
            }
            if (source.scripts() != null) {
                for (SourceScript script : source.scripts()) {
                    files.add(new FrameFile("%s/scripts/%s".formatted(base, script.file()), script.content()));
                }
            }
        }
        return store.save(request.project(), "testframe/sources", files);
    }

    @GetMapping("/{project}")
    public Map<String, Object> load(@PathVariable String project) throws IOException {
        Map<String, Object> loaded = store.load(project, "testframe/sources");

        @SuppressWarnings("unchecked")
        List<Map<String, String>> files = (List<Map<String, String>>) loaded.get("files");

        Map<String, SourceDefinition> byName = new LinkedHashMap<>();
        for (Map<String, String> file : files) {
            String[] parts = file.get("path").split("/");
            String content = file.get("content");
            String key;
            SourceDefinition current;

            if (parts.length == 3 && (parts[2].equals("public-data.md") || parts[2].equals("private-data.md"))) {
                key = parts[0] + "/" + parts[1];
                current = byName.getOrDefault(
                        key, new SourceDefinition(parts[0], parts[1], "", "", List.of()));
                byName.put(key, parts[2].equals("private-data.md")
                        ? current.withPrivateData(content)
                        : current.withPublicData(content));
            } else if (parts.length == 4 && parts[2].equals("scripts") && parts[3].endsWith(".md")) {
                key = parts[0] + "/" + parts[1];
                current = byName.getOrDefault(
                        key, new SourceDefinition(parts[0], parts[1], "", "", List.of()));
                byName.put(key, current.withScript(new SourceScript(parts[3], content)));
            }
        }

        return Map.of(
                "project", loaded.get("project"),
                "root", loaded.get("root"),
                "sources", List.copyOf(byName.values())
        );
    }
}
