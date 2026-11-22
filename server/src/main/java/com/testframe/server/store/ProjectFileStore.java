package com.testframe.server.store;

import com.testframe.server.format.CardCodec;
import com.testframe.server.format.ProjectFile;
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

    /**
     * Generated local files ({@code *.cache.md}: a card's last run, an openapi source's spec):
     * a card's cache is kept while its card exists; none is ever versioned.
     */
    public static final String CACHE_SUFFIX = CardCodec.CACHE_SUFFIX;

    public Map<String, Object> save(String project, String subDir, List<ProjectFile> files) throws IOException {
        return replace(project, subDir, List.of(), List.of(), files);
    }

    /**
     * Writes {@code files} (paths relative to {@code subDir}) and then deletes every other
     * {@code .md} file inside each of the {@code scopes} directories, so each scope ends up
     * holding exactly what was sent. Scopes are relative to {@code subDir} and must be strict
     * sub-directories of it (a scope can never wipe the whole frames/sources tree).
     * {@code staleFiles} are single files (outside the scopes) deleted unless they were sent.
     */
    public Map<String, Object> replace(String project, String subDir, Collection<String> scopes,
                                       Collection<String> staleFiles, List<ProjectFile> files) throws IOException {
        Path dir = resolve(project).resolve(subDir);

        // Validate every path before touching the disk
        Map<Path, String> targets = new LinkedHashMap<>();
        for (ProjectFile file : files) {
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
            if (!targets.containsKey(stale) && Files.deleteIfExists(stale)) {
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
            if (Files.isRegularFile(p) && p.toString().endsWith(".md") && !keep.contains(p)
                    && !isResultOfKeptCard(p, keep)) {
                Files.delete(p);
                removed++;
            } else if (Files.isDirectory(p) && isEmpty(p)) {
                Files.delete(p);
            }
        }
        return removed;
    }

    /** A result file survives a replace only while its card file ({var-file}.md) is kept. */
    private static boolean isResultOfKeptCard(Path p, Set<Path> keep) {
        String name = p.getFileName().toString();
        return name.endsWith(CACHE_SUFFIX)
                && keep.contains(p.resolveSibling(name.substring(0, name.length() - CACHE_SUFFIX.length()) + ".md"));
    }

    /**
     * Writes a generated {@code *.cache.md} file under {@code subDir} (a card's last run under
     * testframe/frames, an openapi spec under testframe/sources) and makes sure the project's
     * testframe/.gitignore ignores cache files (local output, not test definitions).
     */
    public Map<String, Object> saveCache(String project, String subDir, String relativePath, String content)
            throws IOException {
        if (relativePath == null || !relativePath.endsWith(CACHE_SUFFIX)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cache files must end with " + CACHE_SUFFIX);
        }
        Map<String, Object> saved = save(project, subDir, List.of(new ProjectFile(relativePath, content)));
        Path gitignore = resolve(project).resolve("testframe/.gitignore");
        String pattern = "*" + CACHE_SUFFIX;
        String current = Files.exists(gitignore) ? Files.readString(gitignore, StandardCharsets.UTF_8) : "";
        if (current.lines().noneMatch(line -> line.trim().equals(pattern))) {
            String header = current.isEmpty() ? "# Generated local files: last run of each card, openapi spec caches\n" : "\n";
            Files.writeString(gitignore, current + header + pattern + "\n", StandardCharsets.UTF_8);
        }
        return saved;
    }

    private static boolean isEmpty(Path directory) throws IOException {
        try (Stream<Path> entries = Files.list(directory)) {
            return entries.findAny().isEmpty();
        }
    }

    /** Every {@code .md} file under {@code subDir}, paths relative to it, sorted by path. */
    public List<ProjectFile> list(String project, String subDir) throws IOException {
        Path dir = resolve(project).resolve(subDir);
        List<ProjectFile> files = new ArrayList<>();
        if (Files.isDirectory(dir)) {
            try (Stream<Path> walk = Files.walk(dir)) {
                List<Path> paths = walk
                        .filter(Files::isRegularFile)
                        .filter(p -> p.toString().endsWith(".md"))
                        .sorted(Comparator.comparing(Path::toString))
                        .toList();
                for (Path p : paths) {
                    files.add(new ProjectFile(dir.relativize(p).toString().replace('\\', '/'),
                            Files.readString(p, StandardCharsets.UTF_8)));
                }
            }
        }
        return files;
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

    /** Sources are the {type}/{name}.md files (not private nor cache files). */
    private static int countMd(Path sources) throws IOException {
        if (!Files.isDirectory(sources)) {
            return 0;
        }
        try (Stream<Path> walk = Files.walk(sources, 2)) {
            return (int) walk.filter(Files::isRegularFile)
                    .filter(p -> sources.relativize(p).getNameCount() == 2)
                    .map(p -> p.getFileName().toString())
                    .filter(n -> n.endsWith(".md") && !n.endsWith(".private.md") && !n.endsWith(CACHE_SUFFIX))
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
