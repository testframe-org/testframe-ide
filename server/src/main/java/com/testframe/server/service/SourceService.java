package com.testframe.server.service;

import com.testframe.server.dto.Source;
import com.testframe.server.dto.SourcesResponse;
import com.testframe.server.format.CardCodec;
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
import java.util.Optional;

/** Sources of a project in the on-disk format ({@code testframe/sources/}). */
@Service
public class SourceService {

    static final String SOURCES_DIR = "testframe/sources";

    private final ProjectFileStore store;

    public SourceService(ProjectFileStore store) {
        this.store = store;
    }

    public SourcesResponse load(String project) throws IOException {
        SourceCodec.Read read = SourceCodec.read(store.list(project, SOURCES_DIR));
        return new SourcesResponse(read.sources(), read.errors());
    }

    /** Each sent source replaces its files; other sources are untouched. */
    public Map<String, Object> save(String project, List<Source> sources) throws IOException {
        SourceCodec.Written written = SourceCodec.write(sources == null ? List.of() : sources);
        return store.replace(project, SOURCES_DIR, List.of(), written.staleFiles(), written.files());
    }

    /** The generated cache of a source ({@code sources/{type}/{name}.cache.md}, e.g. an openapi spec), when present. */
    public Optional<String> readCache(String project, String type, String name) throws IOException {
        if (Names.sourceNameProblem(name) != null) {
            throw new FormatException("invalid source name: " + name);
        }
        return store.read(project, SOURCES_DIR, type + "/" + name + CardCodec.CACHE_SUFFIX);
    }

    /** Writes {@code sources/{type}/{name}.cache.md} (gitignored by the store). */
    public void writeCache(String project, String type, String name, String content) throws IOException {
        if (Names.sourceNameProblem(name) != null) {
            throw new FormatException("invalid source name: " + name);
        }
        store.saveCache(project, SOURCES_DIR, type + "/" + name + CardCodec.CACHE_SUFFIX, content);
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
