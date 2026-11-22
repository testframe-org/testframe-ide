package com.testframe.server.service;

import com.testframe.server.dto.Source;
import com.testframe.server.dto.SourcesResponse;
import com.testframe.server.format.CardCodec;
import com.testframe.server.dto.Card;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.Step;
import com.testframe.server.format.Catalog;
import com.testframe.server.format.FormatException;
import com.testframe.server.format.FrameCodec;
import com.testframe.server.format.Names;
import com.testframe.server.format.SourceCodec;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.ArrayList;
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

    /**
     * Deletes {@code sources/{type}/{name}.md} with its {@code .private.md} and {@code .cache.md}
     * siblings. Type and name are validated like on save (400); 404 when the source does not
     * exist; 409 (listing the referencing cards) while a card of any frame still uses it.
     */
    public void delete(String project, String type, String name) throws IOException {
        if (type == null || !Catalog.SOURCE_TYPES.contains(type) || !Catalog.hasSources(type)) {
            throw new FormatException("invalid source type: " + type);
        }
        String problem = Names.sourceNameProblem(name);
        if (problem != null) {
            throw new FormatException("invalid source name: " + name + " (" + problem + ")");
        }
        String base = type + "/" + name;
        if (store.read(project, SOURCES_DIR, base + ".md").isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Source not found: " + base);
        }
        List<String> users = new ArrayList<>();
        for (Frame frame : FrameCodec.read(store.list(project, FrameService.FRAMES_DIR)).frames()) {
            for (Step step : frame.steps()) {
                for (Card card : step.cards()) {
                    if (type.equals(card.sourceType()) && name.equals(card.sourceName())) {
                        users.add(frame.name() + "/step-" + step.number() + "/" + card.varName());
                    }
                }
            }
        }
        if (!users.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Source " + base + " is used by cards: " + String.join(", ", users));
        }
        store.delete(project, SOURCES_DIR, List.of(base + ".md", base + ".private.md", base + CardCodec.CACHE_SUFFIX));
    }
}
