package com.testframe.server.store;

import com.testframe.server.dto.FrameFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProjectFileStoreTest {

    @TempDir
    Path root;

    private Path frames() {
        return root.resolve("demo/testframe/frames");
    }

    @Test
    void replaceRemovesStaleCardsOnlyInsideTheSavedFrame() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        store.replace("demo", "testframe/frames", List.of("main", "other"), List.of(), List.of(
                new FrameFile("main/step-1/a-card.md", "a"),
                new FrameFile("main/step-2/b-card.md", "b"),
                new FrameFile("other/step-1/c-card.md", "c")));

        Map<String, Object> result = store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(
                new FrameFile("main/step-1/a-card.md", "a2")));

        assertEquals(1, result.get("saved"));
        assertEquals(1, result.get("removed"));
        assertEquals("a2", Files.readString(frames().resolve("main/step-1/a-card.md")));
        assertFalse(Files.exists(frames().resolve("main/step-2")), "empty step directory is removed");
        assertTrue(Files.exists(frames().resolve("other/step-1/c-card.md")), "other frames are untouched");
    }

    @Test
    void emptyReplaceClearsTheScope() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(new FrameFile("main/step-1/a-card.md", "a")));
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of());
        assertFalse(Files.exists(frames().resolve("main")));
    }

    @Test
    void rejectsTraversalNonMarkdownAndRootScope() {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(), List.of(),
                List.of(new FrameFile("../../etc/passwd.md", "x"))));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(), List.of(),
                List.of(new FrameFile("main/step-1/run.sh", "x"))));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of("."), List.of(),
                List.of()));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(".."), List.of(),
                List.of()));
        assertFalse(Files.exists(root.resolve("demo")), "nothing is written when validation fails");
    }

    @Test
    void privateExampleTemplatesAreNeverPruned() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        Path template = frames().resolve("main/step-1/a-card.private.example.md");
        Files.createDirectories(template.getParent());
        Files.writeString(template, "template");

        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(
                new FrameFile("main/step-1/a-card.md", "a"),
                new FrameFile("main/step-1/a-card.private.md", "secret")));
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of());

        assertTrue(Files.exists(template), "versioned template survives a replace");
        assertFalse(Files.exists(frames().resolve("main/step-1/a-card.private.md")));
    }

    @Test
    void staleFilesOutsideScopesAreDeletedUnlessSent() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        Path sources = root.resolve("demo/testframe/sources");
        store.replace("demo", "testframe/sources", List.of("mongo/db"), List.of(), List.of(
                new FrameFile("mongo/db.md", "pub"),
                new FrameFile("mongo/db.private.md", "priv"),
                new FrameFile("mongo/db/get-all.md", "q")));

        Map<String, Object> result = store.replace("demo", "testframe/sources", List.of("mongo/db"),
                List.of("mongo/db.md", "mongo/db.private.md", "mongo/db.private.example.md"),
                List.of(new FrameFile("mongo/db.md", "pub2")));

        assertEquals(2, result.get("removed"));
        assertEquals("pub2", Files.readString(sources.resolve("mongo/db.md")));
        assertFalse(Files.exists(sources.resolve("mongo/db.private.md")));
        assertFalse(Files.exists(sources.resolve("mongo/db")), "scripts directory pruned when empty");
    }
}
