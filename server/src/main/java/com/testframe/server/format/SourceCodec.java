package com.testframe.server.format;

import com.testframe.server.dto.Source;
import com.testframe.server.dto.SourceScript;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sources (paths relative to {@code testframe/sources/}):
 * <pre>
 *   {type}/{name}.md                  frontmatter base-url + public data
 *   {type}/{name}.private.md          private data, empty frontmatter (gitignored)
 *   {type}/{name}.private.example.md  versioned template, loaded when .private.md is missing
 *   {type}/{name}/{script-file}.md    one script each, empty frontmatter (none for swagger)
 * </pre>
 */
public final class SourceCodec {

    public static final String PRIVATE_SUFFIX = ".private.md";
    public static final String PRIVATE_EXAMPLE_SUFFIX = ".private.example.md";

    /**
     * What a save writes: {@code files}, plus the {@code scopes} (script folders) and
     * {@code staleFiles} ({@code {name}.md}, {@code {name}.private.md}) it replaces.
     */
    public record Written(List<String> scopes, List<String> staleFiles, List<ProjectFile> files) {
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
            }
            String nameProblem = Names.sourceNameProblem(s.name());
            if (nameProblem != null) {
                issues.add(label + "name: " + nameProblem);
            }
            List<SourceScript> scripts = scriptsOf(s);
            for (int j = 0; j < scripts.size(); j++) {
                String problem = Names.camelNameProblem("script name", scripts.get(j).name());
                if (problem != null) {
                    issues.add(label + "scripts." + j + ".name: " + problem);
                }
                String codeProblem = CodeRules.problem(s.typeSource(), scripts.get(j).body());
                if (codeProblem != null) {
                    issues.add(label + "scripts." + j + ".body: " + codeProblem);
                }
            }
        }
        if (!issues.isEmpty()) {
            throw new FormatException(issues);
        }

        List<String> scopes = new ArrayList<>();
        List<String> staleFiles = new ArrayList<>();
        List<ProjectFile> files = new ArrayList<>();
        for (Source s : sources) {
            String base = s.typeSource() + "/" + s.name();
            scopes.add(base);
            staleFiles.add(base + ".md");
            staleFiles.add(base + PRIVATE_SUFFIX);
            Map<String, Object> fields = new LinkedHashMap<>();
            fields.put("base-url", Names.trim(s.baseUrl()));
            files.add(new ProjectFile(base + ".md", MdEnvelope.render(fields, s.publicData())));
            if (!Names.isBlank(s.privateData())) {
                files.add(new ProjectFile(base + PRIVATE_SUFFIX, MdEnvelope.render(s.privateData())));
            }
            if (Catalog.hasScripts(s.typeSource())) {
                for (SourceScript script : scriptsOf(s)) {
                    if (!Names.isBlank(script.body())) {
                        files.add(new ProjectFile(base + "/" + Names.varNameToFileName(script.name()) + ".md",
                                MdEnvelope.render(Map.of(), MdEnvelope.fence(Catalog.languageOf(s.typeSource()), script.body()))));
                    }
                }
            }
        }
        return new Written(scopes, staleFiles, files);
    }

    /** Reads sources from files sorted by path; identity (type, name, script name) comes from the path. */
    public static List<Source> read(List<ProjectFile> files) {
        Map<String, Raw> byKey = new LinkedHashMap<>();
        for (ProjectFile file : files) {
            String[] parts = file.path().split("/");
            if (parts.length == 2) {
                String fileName = parts[1];
                if (fileName.endsWith(PRIVATE_EXAMPLE_SUFFIX)) {
                    raw(byKey, parts[0], strip(fileName, PRIVATE_EXAMPLE_SUFFIX)).privateExample = file.content();
                } else if (fileName.endsWith(PRIVATE_SUFFIX)) {
                    raw(byKey, parts[0], strip(fileName, PRIVATE_SUFFIX)).privateData = file.content();
                } else if (fileName.endsWith(".md")) {
                    raw(byKey, parts[0], strip(fileName, ".md")).publicData = file.content();
                }
            } else if (parts.length == 3 && parts[2].endsWith(".md")) {
                raw(byKey, parts[0], parts[1]).scripts.add(new ProjectFile(parts[2], file.content()));
            }
        }

        List<Source> sources = new ArrayList<>();
        byKey.forEach((key, raw) -> {
            String[] id = key.split("/", 2);
            // The versioned template stands in for a missing (or empty) private file
            String privateContent = raw.privateData.isEmpty() && raw.privateExample != null
                    ? raw.privateExample : raw.privateData;
            MdEnvelope.Parsed pub = MdEnvelope.parse(raw.publicData);
            MdEnvelope.Parsed priv = MdEnvelope.parse(privateContent);
            String baseUrl = baseUrlOf(pub);
            if (baseUrl == null) {
                baseUrl = baseUrlOf(priv);
            }
            List<SourceScript> scripts = raw.scripts.stream()
                    .map(f -> new SourceScript(Names.fileNameToVarName(f.path()), MdEnvelope.unfence(MdEnvelope.parse(f.content()).body())))
                    .toList();
            sources.add(new Source(id[0], id[1], baseUrl, pub.body(), priv.body(), scripts));
        });
        return sources;
    }

    /** Raw files of one source while reading. */
    private static final class Raw {
        String publicData = "";
        String privateData = "";
        String privateExample;
        final List<ProjectFile> scripts = new ArrayList<>();
    }

    private static Raw raw(Map<String, Raw> byKey, String type, String name) {
        return byKey.computeIfAbsent(type + "/" + name, k -> new Raw());
    }

    /** {@code base-url} of a {@code {name}.md} file, or {@code null} when absent or empty. */
    public static String baseUrl(String content) {
        return baseUrlOf(MdEnvelope.parse(content));
    }

    private static String baseUrlOf(MdEnvelope.Parsed md) {
        String value = md.fields().get("base-url");
        return value == null || value.isEmpty() ? null : value;
    }

    private static List<SourceScript> scriptsOf(Source s) {
        return s.scripts() == null ? List.of() : s.scripts();
    }

    private static String strip(String fileName, String suffix) {
        return fileName.substring(0, fileName.length() - suffix.length());
    }
}
