package com.testframe.server.format;

import com.testframe.server.dto.Source;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SourceCodecTest {

    @Test
    void everyCommittedSourceFileRoundTrips() {
        List<ProjectFile> committed = ExampleProject.sources();
        SourceCodec.Read read = SourceCodec.read(committed);
        assertEquals(List.of(), read.errors());
        List<Source> sources = read.sources();
        assertEquals(List.of("mongo/products-db", "openapi/product-api"),
                sources.stream().map(s -> s.typeSource() + "/" + s.name()).toList(), "sources are stored per type");
        assertEquals("mongodb://localhost:27017/products", sources.getFirst().baseUrl());
        assertEquals("http://localhost:18081/api/docs/openapi.json", sources.get(1).baseUrl());
        assertEquals("", sources.get(1).privateData(), "no .private.md: no private data (there are no templates)");

        SourceCodec.Written written = SourceCodec.write(sources);
        Map<String, String> byPath = committed.stream().collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(committed.size(), written.files().size());
        for (ProjectFile file : written.files()) {
            assertEquals(byPath.get(file.path()), file.content(), file.path());
        }
    }

    @Test
    void aSourceIsOnlyItsConnection() {
        Source source = new Source("mongo", "smoke-db", " mongodb://x ", "token: s\n");
        SourceCodec.Written written = SourceCodec.write(List.of(source));
        assertEquals(List.of("mongo/smoke-db.md", "mongo/smoke-db.private.md"), written.staleFiles());
        Map<String, String> files = written.files().stream().collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(Map.of(
                "mongo/smoke-db.md", "-------------------\nbase-url: mongodb://x\n-------------------\n",
                "mongo/smoke-db.private.md", "-------------------\n-------------------\ntoken: s\n"), files);
    }

    @Test
    void writeValidatesEverySource() {
        List<Source> sources = List.of(
                new Source("ftp", "x", null, ""),
                new Source("mongo", "../db", null, ""),
                new Source("jsonassert", "rules", null, ""),
                new Source("openapi", "api.cache", null, ""));
        FormatException e = assertThrows(FormatException.class, () -> SourceCodec.write(sources));
        assertEquals(List.of(
                "Source 1 (x): typeSource: unknown type-source \"ftp\"",
                "Source 1 (x): name: name too short",
                "Source 2 (../db): name: use letters, digits, dot, hyphen and underscore",
                "Source 3 (rules): typeSource: jsonassert has no named sources (its cards hold their own code)",
                "Source 4 (api.cache): name: must not end with .cache or .private (reserved file suffixes)"), e.issues());
    }

    @Test
    void readReportsInvalidSourceFilesAndSkipsCaches() {
        SourceCodec.Read read = SourceCodec.read(List.of(
                new ProjectFile("mongo/db.md", "-------------------\nbase-url: mongodb://x\n-------------------\n# docs\n"),
                new ProjectFile("mongo/ok.md", "-------------------\n-------------------\n"),
                new ProjectFile("mongo/ok.private.md", "-------------------\nbase-url: mongodb://secret\n-------------------\nreal\n"),
                new ProjectFile("mongo/orphan.private.md", "-------------------\n-------------------\nx\n"),
                new ProjectFile("mongo/ok/get-all.md", "-------------------\n-------------------\nq\n"),
                new ProjectFile("openapi/api.cache.md", "-------------------\nspec-url: x\n-------------------\n"),
                new ProjectFile("openapi/api.md", "-------------------\nbase-url: http://x/spec.json\ntitle: API\n-------------------\n")));
        assertEquals(List.of(
                "mongo/ok/get-all.md: path must be {type-source}/{name-source}.md",
                "mongo/db.md: a source file holds only its base-url: remove the body",
                "openapi/api.md: unknown key \"title\" (a source holds only base-url)",
                "mongo/orphan.private.md: private data without a source (mongo/orphan.md missing)"), read.errors());
        assertEquals(List.of("mongo/ok"), read.sources().stream().map(s -> s.typeSource() + "/" + s.name()).toList());
        assertEquals("real", read.sources().getFirst().privateData());
        assertEquals("mongodb://secret", read.sources().getFirst().baseUrl(), "base-url falls back to the private file");
        assertNull(SourceCodec.baseUrl("-------------------\nbase-url:\n-------------------\n"));
    }
}
