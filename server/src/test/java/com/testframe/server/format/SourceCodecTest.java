package com.testframe.server.format;

import com.testframe.server.dto.Source;
import com.testframe.server.dto.SourceScript;
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
        List<Source> sources = SourceCodec.read(committed);
        assertEquals(List.of("assert/assertions-core", "mongo/products-db", "restapi/framework-echo-api", "swagger/product-api"),
                sources.stream().map(s -> s.typeSource() + "/" + s.name()).toList());
        Source mongo = sources.get(1);
        assertEquals("mongodb://localhost:27017/products", mongo.baseUrl());
        assertEquals(List.of("getActiveProducts", "getProductsByCategory"), mongo.scripts().stream().map(SourceScript::name).toList());
        assertEquals("db.products.find({ ativo: true })", mongo.scripts().getFirst().body());
        assertEquals("# Access\n\nLocal example, no authentication.", sources.get(3).privateData(), "template is the fallback");

        SourceCodec.Written written = SourceCodec.write(sources);
        Map<String, String> byPath = committed.stream().collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(committed.size(), written.files().size());
        for (ProjectFile file : written.files()) {
            String path = ExampleProject.committedPathOf(file.path(), committed);
            assertEquals(byPath.get(path), file.content(), path);
        }
    }

    @Test
    void writeLayoutAndReplaceScopes() {
        Source source = new Source("mongo", "smoke-db", " mongodb://x ", "# docs\n", "  ",
                List.of(new SourceScript("smokeQuery", "db.x.find()\n"), new SourceScript("draftQuery", " ")));
        SourceCodec.Written written = SourceCodec.write(List.of(source));
        assertEquals(List.of("mongo/smoke-db"), written.scopes());
        assertEquals(List.of("mongo/smoke-db.md", "mongo/smoke-db.private.md"), written.staleFiles());
        Map<String, String> files = written.files().stream().collect(Collectors.toMap(ProjectFile::path, ProjectFile::content));
        assertEquals(Map.of(
                "mongo/smoke-db.md", "-------------------\nbase-url: mongodb://x\n-------------------\n# docs\n",
                "mongo/smoke-db/smoke-query.md", "-------------------\n-------------------\n```js\ndb.x.find()\n```\n"), files);
    }

    @Test
    void swaggerSourcesHaveNoScripts() {
        Source swagger = new Source("swagger", "api", "http://x/openapi.json", "", "", List.of(new SourceScript("getAll", "x")));
        assertEquals(List.of("swagger/api.md"), SourceCodec.write(List.of(swagger)).files().stream().map(ProjectFile::path).toList());
    }

    @Test
    void writeValidatesEverySource() {
        List<Source> sources = List.of(
                new Source("ftp", "x", null, "", "", List.of()),
                new Source("mongo", "../db", null, "", "", List.of(new SourceScript("Get-all", "q"))));
        FormatException e = assertThrows(FormatException.class, () -> SourceCodec.write(sources));
        assertEquals(List.of(
                "Source 1 (x): typeSource: unknown type-source \"ftp\"",
                "Source 1 (x): name: name too short",
                "Source 2 (../db): name: use letters, digits, dot, hyphen and underscore",
                "Source 2 (../db): scripts.0.name: script name must be camelCase",
                "Source 2 (../db): scripts.0.body: mongo cards accept one mongo shell call, e.g. db.products.find({ ativo: true })"), e.issues());
    }

    @Test
    void realPrivateFileWinsOverItsTemplate() {
        List<Source> sources = SourceCodec.read(List.of(
                new ProjectFile("mongo/db.md", "-------------------\n-------------------\n"),
                new ProjectFile("mongo/db.private.example.md", "-------------------\n-------------------\ntemplate\n"),
                new ProjectFile("mongo/db.private.md", "-------------------\nbase-url: mongodb://secret\n-------------------\nreal\n")));
        assertEquals("real", sources.getFirst().privateData());
        assertEquals("mongodb://secret", sources.getFirst().baseUrl(), "base-url falls back to the private file");
        assertNull(SourceCodec.baseUrl("-------------------\nbase-url:\n-------------------\n"));
    }
}
