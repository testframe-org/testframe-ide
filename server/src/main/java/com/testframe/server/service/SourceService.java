package com.testframe.server.service;

import com.testframe.server.dto.Source;
import com.testframe.server.format.FormatException;
import com.testframe.server.format.Names;
import com.testframe.server.format.SourceCodec;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/** Sources of a project in the on-disk format ({@code testframe/sources/}). */
@Service
public class SourceService {

    static final String SOURCES_DIR = "testframe/sources";

    private final ProjectFileStore store;

    public SourceService(ProjectFileStore store) {
        this.store = store;
    }

    public List<Source> load(String project) throws IOException {
        return SourceCodec.read(store.list(project, SOURCES_DIR));
    }

    /** Each sent source replaces its files and script folder; other sources are untouched. */
    public Map<String, Object> save(String project, List<Source> sources) throws IOException {
        SourceCodec.Written written = SourceCodec.write(sources == null ? List.of() : sources);
        return store.replace(project, SOURCES_DIR, written.scopes(), written.staleFiles(), written.files());
    }

    /** {@code base-url} of {@code sources/{type}/{name}.md}: 404 when the file is missing, 400 without base-url. */
    public String baseUrl(String project, String type, String name) throws IOException {
        if (Names.sourceNameProblem(name) != null) {
            throw new FormatException("invalid source name: " + name);
        }
        String file = type + "/" + name + ".md";
        String content = store.read(project, SOURCES_DIR, file)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Source file not found: sources/" + file + " (save the sources first)"));
        String baseUrl = SourceCodec.baseUrl(content);
        if (baseUrl == null || Names.isBlank(baseUrl)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sources/" + file + " has no base-url");
        }
        return Names.trim(baseUrl);
    }
}
