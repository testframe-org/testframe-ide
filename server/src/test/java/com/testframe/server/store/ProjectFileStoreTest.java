package com.testframe.server.store;

import com.testframe.server.format.ProjectFile;
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
                new ProjectFile("main/step-1/a-card.md", "a"),
                new ProjectFile("main/step-2/b-card.md", "b"),
                new ProjectFile("other/step-1/c-card.md", "c")));

        Map<String, Object> result = store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(
                new ProjectFile("main/step-1/a-card.md", "a2")));

        assertEquals(1, result.get("saved"));
        assertEquals(1, result.get("removed"));
        assertEquals("a2", Files.readString(frames().resolve("main/step-1/a-card.md")));
        assertFalse(Files.exists(frames().resolve("main/step-2")), "empty step directory is removed");
        assertTrue(Files.exists(frames().resolve("other/step-1/c-card.md")), "other frames are untouched");
    }

    @Test
    void emptyReplaceClearsTheScope() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(new ProjectFile("main/step-1/a-card.md", "a")));
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of());
        assertFalse(Files.exists(frames().resolve("main")));
    }

    @Test
    void rejectsTraversalNonMarkdownAndRootScope() {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(), List.of(),
                List.of(new ProjectFile("../../etc/passwd.md", "x"))));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(), List.of(),
                List.of(new ProjectFile("main/step-1/run.sh", "x"))));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of("."), List.of(),
                List.of()));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(".."), List.of(),
                List.of()));
        assertFalse(Files.exists(root.resolve("demo")), "nothing is written when validation fails");
    }

    @Test
    void privateFilesArePrunedWithTheirCard() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(
                new ProjectFile("main/step-1/a-card.md", "a"),
                new ProjectFile("main/step-1/a-card.private.md", "secret")));
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of());

        assertFalse(Files.exists(frames().resolve("main/step-1/a-card.private.md")), "no template survives: there are none");
    }

    @Test
    void staleFilesOutsideScopesAreDeletedUnlessSent() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        Path sources = root.resolve("demo/testframe/sources");
        store.replace("demo", "testframe/sources", List.of(), List.of(), List.of(
                new ProjectFile("mongo/db.md", "pub"),
                new ProjectFile("mongo/db.private.md", "priv")));

        Map<String, Object> result = store.replace("demo", "testframe/sources", List.of(),
                List.of("mongo/db.md", "mongo/db.private.md"),
                List.of(new ProjectFile("mongo/db.md", "pub2")));

        assertEquals(1, result.get("removed"));
        assertEquals("pub2", Files.readString(sources.resolve("mongo/db.md")));
        assertFalse(Files.exists(sources.resolve("mongo/db.private.md")));
    }

    @Test
    void listsProjectsWithCounts() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(
                new ProjectFile("main/step-1/a-card.md", "a")));
        store.replace("demo", "testframe/sources", List.of(), List.of(), List.of(
                new ProjectFile("mongo/db.md", "pub"),
                new ProjectFile("mongo/db.private.md", "priv")));
        Files.createDirectories(root.resolve("not-a-project"));

        List<ProjectFileStore.ProjectSummary> projects = store.listProjects();

        assertEquals(1, projects.size());
        assertEquals("demo", projects.getFirst().name());
        assertEquals(1, projects.getFirst().frames());
        assertEquals(1, projects.getFirst().sources());
    }

    @Test
    void resultFilesFollowTheirCardAndAreGitignored() throws Exception {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(
                new ProjectFile("main/step-1/a-card.md", "a"),
                new ProjectFile("main/step-1/b-card.md", "b")));
        store.saveCache("demo", "testframe/frames", "main/step-1/a-card.cache.md", "ok");
        store.saveCache("demo", "testframe/frames", "main/step-1/b-card.cache.md", "ok");
        store.saveCache("demo", "testframe/frames", "main/step-1/b-card.cache.md", "ok again");
        assertThrows(ResponseStatusException.class, () -> store.saveCache("demo", "testframe/frames", "main/step-1/a-card.md", "x"));

        // saving the frame without b-card keeps a's result and drops b's
        store.replace("demo", "testframe/frames", List.of("main"), List.of(), List.of(
                new ProjectFile("main/step-1/a-card.md", "a")));

        assertTrue(Files.exists(frames().resolve("main/step-1/a-card.cache.md")));
        assertFalse(Files.exists(frames().resolve("main/step-1/b-card.cache.md")));
        String gitignore = Files.readString(root.resolve("demo/testframe/.gitignore"));
        assertEquals(1, gitignore.lines().filter("*.cache.md"::equals).count());
    }
}
