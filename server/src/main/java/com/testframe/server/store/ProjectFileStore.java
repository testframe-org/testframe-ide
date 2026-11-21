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

    /** Versioned templates for private files ({@code <name>.private.example.md}): never pruned by a save. */
    public static final String PRIVATE_EXAMPLE_SUFFIX = ".private.example.md";

    public Map<String, Object> save(String project, String subDir, List<FrameFile> files) throws IOException {
        return replace(project, subDir, List.of(), List.of(), files);
    }

    /**
     * Writes {@code files} (paths relative to {@code subDir}) and then deletes every other
     * {@code .md} file inside each of the {@code scopes} directories, so each scope ends up
     * holding exactly what was sent. Scopes are relative to {@code subDir} and must be strict
     * sub-directories of it (a scope can never wipe the whole frames/sources tree).
     * {@code staleFiles} are single files (outside the scopes) deleted unless they were sent.
     * {@code *.private.example.md} templates are never deleted.
     */
    public Map<String, Object> replace(String project, String subDir, Collection<String> scopes,
                                       Collection<String> staleFiles, List<FrameFile> files) throws IOException {
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
        List<Path> stalePaths = new ArrayList<>();
        for (String stale : new LinkedHashSet<>(staleFiles)) {
            Path stalePath = resolve(stale, dir);
            if (!stalePath.getFileName().toString().endsWith(".md")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only .md files can be removed: " + stale);
            }
            stalePaths.add(stalePath);
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
        for (Path stale : stalePaths) {
            if (!targets.containsKey(stale) && !isPrivateExample(stale) && Files.deleteIfExists(stale)) {
                removed++;
            }
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
            if (Files.isRegularFile(p) && p.toString().endsWith(".md") && !keep.contains(p) && !isPrivateExample(p)) {
                Files.delete(p);
                removed++;
            } else if (Files.isDirectory(p) && isEmpty(p)) {
                Files.delete(p);
            }
        }
        return removed;
    }

    private static boolean isPrivateExample(Path p) {
        return p.getFileName().toString().endsWith(PRIVATE_EXAMPLE_SUFFIX);
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

    /** A project folder: {projects-dir}/{name}/testframe/{frames,sources}. */
    public record ProjectSummary(String name, int frames, int sources, String lastModified) {
    }

    /** Every directory under the projects dir that holds a testframe/ folder, most recent first. */
    public List<ProjectSummary> listProjects() throws IOException {
        if (!Files.isDirectory(root)) {
            return List.of();
        }
        List<ProjectSummary> projects = new ArrayList<>();
        try (Stream<Path> dirs = Files.list(root)) {
            for (Path dir : dirs.filter(Files::isDirectory).toList()) {
                Path testframe = dir.resolve("testframe");
                if (!Files.isDirectory(testframe)) {
                    continue;
                }
                int frames = countDirs(testframe.resolve("frames"));
                int sources = countMd(testframe.resolve("sources"));
                java.nio.file.attribute.FileTime latest = Files.getLastModifiedTime(testframe);
                try (Stream<Path> walk = Files.walk(testframe)) {
                    for (Path p : walk.toList()) {
                        java.nio.file.attribute.FileTime t = Files.getLastModifiedTime(p);
                        if (t.compareTo(latest) > 0) {
                            latest = t;
                        }
                    }
                }
                projects.add(new ProjectSummary(dir.getFileName().toString(), frames, sources, latest.toInstant().toString()));
            }
        }
        projects.sort(Comparator.comparing(ProjectSummary::lastModified).reversed());
        return projects;
    }

    private static int countDirs(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) {
            return 0;
        }
        try (Stream<Path> list = Files.list(dir)) {
            return (int) list.filter(Files::isDirectory).count();
        }
    }

    /** Sources are the {type}/{name}.md files (not private files nor scripts). */
    private static int countMd(Path sources) throws IOException {
        if (!Files.isDirectory(sources)) {
            return 0;
        }
        try (Stream<Path> walk = Files.walk(sources, 2)) {
            return (int) walk.filter(Files::isRegularFile)
                    .filter(p -> sources.relativize(p).getNameCount() == 2)
                    .map(p -> p.getFileName().toString())
                    .filter(n -> n.endsWith(".md") && !n.contains(".private."))
                    .count();
        }
    }

    /** Reads one .md file of a project (path validated like every other access), if it exists. */
    public java.util.Optional<String> read(String project, String subDir, String relativePath) throws IOException {
        Path file = resolve(relativePath, resolve(project).resolve(subDir));
        if (!file.getFileName().toString().endsWith(".md") || !Files.isRegularFile(file)) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(Files.readString(file, StandardCharsets.UTF_8));
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
