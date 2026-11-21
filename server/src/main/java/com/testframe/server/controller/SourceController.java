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

    // Layout per source (see docs/project-format.md):
    //   {type}/{name}.md                  public data (base-url + docs)
    //   {type}/{name}.private.md          private data (gitignored)
    //   {type}/{name}.private.example.md  versioned template, loaded when .private.md is missing
    //   {type}/{name}/{script}.md         one custom script each
    private static final String PRIVATE_SUFFIX = ".private.md";

    @PostMapping
    public Map<String, Object> save(@RequestBody SaveSourcesRequest request) throws IOException {
        // Each sent source is replaced: removed scripts / cleared private data do not linger
        List<FrameFile> files = new ArrayList<>();
        List<String> scopes = new ArrayList<>();
        List<String> staleFiles = new ArrayList<>();
        for (SourceDefinition source : request.sources()) {
            String base = "%s/%s".formatted(source.typeSource(), source.name());
            scopes.add(base);
            staleFiles.add(base + ".md");
            staleFiles.add(base + PRIVATE_SUFFIX);
            if (source.publicData() != null && !source.publicData().isBlank()) {
                files.add(new FrameFile(base + ".md", source.publicData()));
            }
            if (source.privateData() != null && !source.privateData().isBlank()) {
                files.add(new FrameFile(base + PRIVATE_SUFFIX, source.privateData()));
            }
            if (source.scripts() != null) {
                for (SourceScript script : source.scripts()) {
                    files.add(new FrameFile("%s/%s".formatted(base, script.file()), script.content()));
                }
            }
        }
        return store.replace(request.project(), "testframe/sources", scopes, staleFiles, files);
    }

    @GetMapping("/{project}")
    public Map<String, Object> load(@PathVariable String project) throws IOException {
        Map<String, Object> loaded = store.load(project, "testframe/sources");

        @SuppressWarnings("unchecked")
        List<Map<String, String>> files = (List<Map<String, String>>) loaded.get("files");

        Map<String, SourceDefinition> byName = new LinkedHashMap<>();
        Map<String, String> privateExamples = new LinkedHashMap<>();
        for (Map<String, String> file : files) {
            String[] parts = file.get("path").split("/");
            String content = file.get("content");
            if (parts.length == 2) {
                String fileName = parts[1];
                if (fileName.endsWith(ProjectFileStore.PRIVATE_EXAMPLE_SUFFIX)) {
                    String key = parts[0] + "/" + strip(fileName, ProjectFileStore.PRIVATE_EXAMPLE_SUFFIX);
                    privateExamples.put(key, content);
                    source(byName, key);
                } else if (fileName.endsWith(PRIVATE_SUFFIX)) {
                    String key = parts[0] + "/" + strip(fileName, PRIVATE_SUFFIX);
                    byName.put(key, source(byName, key).withPrivateData(content));
                } else if (fileName.endsWith(".md")) {
                    String key = parts[0] + "/" + strip(fileName, ".md");
                    byName.put(key, source(byName, key).withPublicData(content));
                }
            } else if (parts.length == 3 && parts[2].endsWith(".md")) {
                String key = parts[0] + "/" + parts[1];
                byName.put(key, source(byName, key).withScript(new SourceScript(parts[2], content)));
            }
        }
        // The versioned template stands in for a missing private file
        privateExamples.forEach((key, content) -> {
            SourceDefinition current = byName.get(key);
            if (current.privateData() == null || current.privateData().isEmpty()) {
                byName.put(key, current.withPrivateData(content));
            }
        });

        return Map.of(
                "project", loaded.get("project"),
                "root", loaded.get("root"),
                "sources", List.copyOf(byName.values())
        );
    }

    private static SourceDefinition source(Map<String, SourceDefinition> byName, String key) {
        return byName.computeIfAbsent(key, k -> {
            String[] parts = k.split("/", 2);
            return new SourceDefinition(parts[0], parts[1], "", "", List.of());
        });
    }

    private static String strip(String fileName, String suffix) {
        return fileName.substring(0, fileName.length() - suffix.length());
    }
}
