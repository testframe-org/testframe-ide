package com.testframe.server.format;

import com.testframe.server.dto.Source;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sources (paths relative to {@code testframe/sources/}): a source is only its connection.
 * <pre>
 *   {type}/{name}.md            frontmatter base-url, nothing else (a body is invalid)
 *   {type}/{name}.private.md    private data, empty frontmatter (gitignored)
 *   {type}/{name}.cache.md      generated cache (openapi operations), gitignored, never read as a source
 * </pre>
 * Sources are stored per TYPE (openapi, mongo, sql, kafka, grpc); the subtype is chosen by each
 * card, and the card's code always lives in the card.
 */
public final class SourceCodec {

    public static final String PRIVATE_SUFFIX = ".private.md";

    /** What a save writes: {@code files}, plus the {@code staleFiles} ({@code {name}.md}, {@code {name}.private.md}) it replaces. */
    public record Written(List<String> staleFiles, List<ProjectFile> files) {
    }

    /** Sources read from disk; invalid source files are reported in {@code errors} and skipped. */
    public record Read(List<Source> sources, List<String> errors) {
    }

    private SourceCodec() {
    }

    /** Validates and serializes sources. Throws {@link FormatException} listing every problem. */
    public static Written write(List<Source> sources) {
        List<String> issues = new ArrayList<>();
        for (int i = 0; i < sources.size(); i++) {
            Source s = sources.get(i);
            String label = "Source %d (%s): ".formatted(i + 1, s.name() == null || s.name().isEmpty() ? "?" : s.name());
            if (!Catalog.SOURCE_TYPES.contains(s.typeSource())) {
                issues.add(label + "typeSource: unknown type-source \"" + s.typeSource() + "\"");
            } else if (!Catalog.hasSources(s.typeSource())) {
                issues.add(label + "typeSource: " + s.typeSource() + " has no named sources (its cards hold their own code)");
            }
            String nameProblem = Names.sourceNameProblem(s.name());
            if (nameProblem != null) {
                issues.add(label + "name: " + nameProblem);
            }
        }
        if (!issues.isEmpty()) {
            throw new FormatException(issues);
        }

        List<String> staleFiles = new ArrayList<>();
        List<ProjectFile> files = new ArrayList<>();
        for (Source s : sources) {
            String base = s.typeSource() + "/" + s.name();
            staleFiles.add(base + ".md");
            staleFiles.add(base + PRIVATE_SUFFIX);
            Map<String, Object> fields = new LinkedHashMap<>();
            fields.put("base-url", Names.trim(s.baseUrl()));
            files.add(new ProjectFile(base + ".md", MdEnvelope.render(fields, "")));
            if (!Names.isBlank(s.privateData())) {
                files.add(new ProjectFile(base + PRIVATE_SUFFIX, MdEnvelope.render(s.privateData())));
            }
        }
        return new Written(staleFiles, files);
    }

    /** Reads sources from files sorted by path; identity (type, name) comes from the path. */
    public static Read read(List<ProjectFile> files) {
        Map<String, String> publics = new LinkedHashMap<>();
        Map<String, String> privates = new LinkedHashMap<>();
        List<String> errors = new ArrayList<>();
        for (ProjectFile file : files) {
            String[] parts = file.path().split("/");
            String fileName = parts[parts.length - 1];
            if (fileName.endsWith(CardCodec.CACHE_SUFFIX)) {
                continue; // generated (an openapi operations cache), not part of the source
            }
            if (parts.length != 2) {
                errors.add(file.path() + ": path must be {type-source}/{name-source}.md");
            } else if (fileName.endsWith(PRIVATE_SUFFIX)) {
                privates.put(parts[0] + "/" + strip(fileName, PRIVATE_SUFFIX), file.content());
            } else if (fileName.endsWith(".md")) {
                publics.put(parts[0] + "/" + strip(fileName, ".md"), file.content());
            }
        }

        List<Source> sources = new ArrayList<>();
        publics.forEach((key, content) -> {
            String[] id = key.split("/", 2);
            MdEnvelope.Parsed pub = MdEnvelope.parse(content);
            List<String> problems = new ArrayList<>();
            if (!Catalog.SOURCE_TYPES.contains(id[0]) || !Catalog.hasSources(id[0])) {
                problems.add("unknown type-source \"" + id[0] + "\"");
            }
            for (String key2 : pub.fields().keySet()) {
                if (!"base-url".equals(key2)) {
                    problems.add("unknown key \"" + key2 + "\" (a source holds only base-url)");
                }
            }
            if (!Names.isBlank(pub.body())) {
                problems.add("a source file holds only its base-url: remove the body");
            }
            if (!problems.isEmpty()) {
                errors.add("%s.md: %s".formatted(key, String.join("; ", problems)));
                return;
            }
            String priv = privates.remove(key);
            MdEnvelope.Parsed privMd = priv == null ? null : MdEnvelope.parse(priv);
            String baseUrl = baseUrlOf(pub);
            if (baseUrl == null && privMd != null) {
                baseUrl = baseUrlOf(privMd);
            }
            sources.add(new Source(id[0], id[1], baseUrl, privMd == null ? "" : privMd.body()));
        });
        privates.keySet().forEach(key -> {
            if (!publics.containsKey(key)) {
                errors.add("%s.private.md: private data without a source (%s.md missing)".formatted(key, key));
            }
        });
        return new Read(sources, errors);
    }

    /** {@code base-url} of a {@code {name}.md} file, or {@code null} when absent or empty. */
    public static String baseUrl(String content) {
        return baseUrlOf(MdEnvelope.parse(content));
    }

    private static String baseUrlOf(MdEnvelope.Parsed md) {
        String value = md.fields().get("base-url");
        return value == null || value.isEmpty() ? null : value;
    }

    private static String strip(String fileName, String suffix) {
        return fileName.substring(0, fileName.length() - suffix.length());
    }
}
