package com.testframe.server.store;

import com.testframe.server.dto.FrameFile;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

@Service
public class ProjectFileStore {

    private final Path root;

    public ProjectFileStore(@Value("${app.projects-dir:../projects}") String projectsDir) {
        this.root = Path.of(projectsDir).toAbsolutePath().normalize();
    }

    public Map<String, Object> save(String project, String subDir, List<FrameFile> files) throws IOException {
        return replace(project, subDir, List.of(), files);
    }

    /**
     * Writes {@code files} (paths relative to {@code subDir}) and then deletes every other
     * {@code .md} file inside each of the {@code scopes} directories, so each scope ends up
     * holding exactly what was sent. Scopes are relative to {@code subDir} and must be strict
     * sub-directories of it (a scope can never wipe the whole frames/sources tree).
     */
    public Map<String, Object> replace(String project, String subDir, Collection<String> scopes,
                                       List<FrameFile> files) throws IOException {
        Path dir = resolve(project).resolve(subDir);

        // Validate every path before touching the disk
        Map<Path, String> targets = new LinkedHashMap<>();
        for (FrameFile file : files) {
            Path target = resolve(file.path(), dir);
            if (!target.getFileName().toString().endsWith(".md")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only .md files can be stored: " + file.path());
            }
            targets.put(target, file.content() == null ? "" : file.content());
        }
        List<Path> scopeDirs = new ArrayList<>();
        for (String scope : new LinkedHashSet<>(scopes)) {
            Path scopeDir = resolve(scope, dir);
            if (scopeDir.equals(dir)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid scope: " + scope);
            }
            scopeDirs.add(scopeDir);
        }

        for (Map.Entry<Path, String> entry : targets.entrySet()) {
            Path target = entry.getKey();
            Files.createDirectories(target.getParent());
            Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
            Files.writeString(tmp, entry.getValue(), StandardCharsets.UTF_8);
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }

        int removed = 0;
        for (Path scopeDir : scopeDirs) {
            removed += prune(scopeDir, targets.keySet());
        }

        return Map.of("project", project, "root", dir.toString(), "saved", targets.size(), "removed", removed);
    }

    /** Deletes stale .md files under {@code scopeDir} (keeping {@code keep}) and the directories left empty. */
    private int prune(Path scopeDir, Set<Path> keep) throws IOException {
        if (!Files.isDirectory(scopeDir)) {
            return 0;
        }
        int removed = 0;
        List<Path> all;
        try (Stream<Path> walk = Files.walk(scopeDir)) {
            all = walk.sorted(Comparator.reverseOrder()).toList(); // children before parents
        }
        for (Path p : all) {
            if (Files.isRegularFile(p) && p.toString().endsWith(".md") && !keep.contains(p)) {
                Files.delete(p);
                removed++;
            } else if (Files.isDirectory(p) && isEmpty(p)) {
                Files.delete(p);
            }
        }
        return removed;
    }

    private static boolean isEmpty(Path directory) throws IOException {
        try (Stream<Path> entries = Files.list(directory)) {
            return entries.findAny().isEmpty();
        }
    }

    public Map<String, Object> load(String project, String subDir) throws IOException {
        Path dir = resolve(project).resolve(subDir);
        List<Map<String, String>> files = new ArrayList<>();

        if (Files.isDirectory(dir)) {
            try (Stream<Path> walk = Files.walk(dir)) {
                List<Path> paths = walk
                        .filter(Files::isRegularFile)
                        .filter(p -> p.toString().endsWith(".md"))
                        .sorted(Comparator.comparing(Path::toString))
                        .toList();
                for (Path p : paths) {
                    files.add(Map.of(
                            "path", dir.relativize(p).toString().replace('\\', '/'),
                            "content", Files.readString(p, StandardCharsets.UTF_8)
                    ));
                }
            }
        }

        return Map.of("project", project, "root", dir.toString(), "files", files);
    }

    private Path resolve(String relative) {
        return resolve(relative, root);
    }

    private Path resolve(String relative, Path baseDir) {
        if (relative == null || relative.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid project/file name");
        }
        String cleaned = relative.replace("..", "").trim();
        if (!cleaned.matches("[A-Za-z0-9 ._/\\-\\u00C0-\\u01FF]+")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid character in path: " + relative);
        }
        Path resolved = baseDir.resolve(cleaned).normalize();
        if (!resolved.startsWith(baseDir)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Path outside the projects directory");
        }
        return resolved;
    }
}
