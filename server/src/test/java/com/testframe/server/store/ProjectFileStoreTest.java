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
        store.replace("demo", "testframe/frames", List.of("main", "other"), List.of(
                new FrameFile("main/step-1/a-card.md", "a"),
                new FrameFile("main/step-2/b-card.md", "b"),
                new FrameFile("other/step-1/c-card.md", "c")));

        Map<String, Object> result = store.replace("demo", "testframe/frames", List.of("main"), List.of(
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
        store.replace("demo", "testframe/frames", List.of("main"), List.of(new FrameFile("main/step-1/a-card.md", "a")));
        store.replace("demo", "testframe/frames", List.of("main"), List.of());
        assertFalse(Files.exists(frames().resolve("main")));
    }

    @Test
    void rejectsTraversalNonMarkdownAndRootScope() {
        ProjectFileStore store = new ProjectFileStore(root.toString());
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(),
                List.of(new FrameFile("../../etc/passwd.md", "x"))));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(),
                List.of(new FrameFile("main/step-1/run.sh", "x"))));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of("."),
                List.of()));
        assertThrows(ResponseStatusException.class, () -> store.replace("demo", "testframe/frames", List.of(".."),
                List.of()));
        assertFalse(Files.exists(root.resolve("demo")), "nothing is written when validation fails");
    }
}
