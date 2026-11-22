package com.testframe.server.format;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/** The committed reference project (examples/product-test/testframe), read like the store does. */
final class ExampleProject {

    static final Path ROOT = Path.of("../examples/product-test/testframe").toAbsolutePath().normalize();

    private ExampleProject() {
    }

    static List<ProjectFile> frames() {
        return list(ROOT.resolve("frames"));
    }

    static List<ProjectFile> sources() {
        return list(ROOT.resolve("sources"));
    }

    private static List<ProjectFile> list(Path dir) {
        try (Stream<Path> walk = Files.walk(dir)) {
            return walk.filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".md"))
                    .filter(p -> !isLocalOnly(p.getFileName().toString()))
                    .sorted(Comparator.comparing(Path::toString))
                    .map(p -> new ProjectFile(dir.relativize(p).toString().replace('\\', '/'), read(p)))
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * Gitignored files a running editor leaves next to the committed ones ({@code *.cache.md}:
     * last runs and openapi caches; {@code *.private.md}): never part of the reference project.
     */
    private static boolean isLocalOnly(String fileName) {
        return fileName.endsWith(CardCodec.CACHE_SUFFIX) || fileName.endsWith(".private.md");
    }

    private static String read(Path p) {
        try {
            return Files.readString(p, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
