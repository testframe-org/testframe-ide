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
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

@Service
public class ProjectFileStore {

    private final Path root;

    public ProjectFileStore(@Value("${app.projects-dir:../projects}") String projectsDir) {
        this.root = Path.of(projectsDir).toAbsolutePath().normalize();
    }

    public Map<String, Object> save(String project, String subDir, List<FrameFile> files) throws IOException {
        Path dir = resolve(project).resolve(subDir);
        int saved = 0;

        for (FrameFile file : files) {
            Path target = resolve(file.path(), dir);
            Files.createDirectories(target.getParent());
            Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
            Files.writeString(tmp, file.content(), StandardCharsets.UTF_8);
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            saved++;
        }

        return Map.of("project", project, "root", dir.toString(), "saved", saved);
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
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nome de projeto/arquivo invalido");
        }
        String cleaned = relative.replace("..", "").trim();
        if (!cleaned.matches("[A-Za-z0-9 ._/\\-\\u00C0-\\u01FF]+")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Caractere invalido no caminho: " + relative);
        }
        Path resolved = baseDir.resolve(cleaned).normalize();
        if (!resolved.startsWith(baseDir)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Caminho fora da pasta de projetos");
        }
        return resolved;
    }
}
