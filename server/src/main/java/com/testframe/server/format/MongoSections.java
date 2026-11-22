package com.testframe.server.format;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The body of a mongo card file: a sequence of LABELED sections, each a label line followed by
 * its own fenced json block (spec: docs/project-format.md, "Mongo cards").
 * <pre>
 *   find:                  aggregation (one section, the pipeline):
 *   filter                 aggregation
 *   ```json                ```json
 *   { "ativo": true }      [
 *   ```                      { "$match": { "ativo": true } },
 *   projection               { "$group": { "_id": "$categoria", "total": { "$sum": 1 } } }
 *   ```json                ]
 *   { "nome": 1 }          ```
 *   ```
 * </pre>
 * The labels are the subtype's sections ({@link MongoQuery#sectionsOf}), each at most once. On
 * the wire the card's {@code code} stays one JSON object keyed by section
 * ({@code {"filter": ..., "projection": ...}} or {@code {"aggregation": [...]}}); this class
 * converts between the two. Values are kept as written (so {@code {{bindings}}} survive),
 * trimmed and without blank lines. Rendering writes the sections in the subtype's fixed order;
 * parsing tolerates blank lines and whitespace between and inside sections.
 */
public final class MongoSections {

    private static final String FENCE_OPEN = "```json";
    private static final String FENCE_CLOSE = "```";

    private MongoSections() {
    }

    private static List<String> labels(String subtype) {
        List<String> labels = MongoQuery.sectionsOf(subtype).stream().map(MongoQuery.Section::name).toList();
        if (!labels.isEmpty()) {
            return labels;
        }
        List<String> all = new ArrayList<>(MongoQuery.FIND_KEYS); // unknown subtype: reported elsewhere
        all.addAll(MongoQuery.AGGREGATION_KEYS);
        return all;
    }

    /**
     * Renders the wire code as labeled sections, or {@code null} when the code is not a JSON
     * object of sections (a draft: the code rule reports why, and the caller keeps it fenced).
     */
    public static String render(String subtype, String code) {
        if (code == null || code.isBlank()) {
            return "";
        }
        Map<String, String> sections;
        try {
            sections = split(code);
        } catch (IllegalArgumentException e) {
            return null;
        }
        List<String> order = new ArrayList<>(labels(subtype));
        sections.keySet().stream().filter(k -> !order.contains(k)).forEach(order::add); // unknown keys last
        List<String> out = new ArrayList<>();
        for (String label : order) {
            if (sections.containsKey(label)) {
                out.add(label + "\n" + FENCE_OPEN + "\n" + normalize(sections.get(label)) + "\n" + FENCE_CLOSE);
            }
        }
        return String.join("\n", out);
    }

    /** Reads labeled sections into the wire code; IllegalArgumentException names the problem. */
    public static String parse(String subtype, String body) {
        List<String> allowed = labels(subtype);
        Map<String, String> sections = new LinkedHashMap<>();
        List<String> lines = (body == null ? "" : body).lines().toList();
        int i = 0;
        while (i < lines.size()) {
            String label = lines.get(i).trim();
            if (label.isEmpty()) {
                i++;
                continue;
            }
            if (label.startsWith(FENCE_CLOSE)) {
                throw new IllegalArgumentException("a ```json block without a section label before it");
            }
            if (!allowed.contains(label)) {
                throw new IllegalArgumentException("unknown section \"" + label + "\" ("
                        + (subtype == null ? "mongo" : subtype) + " accepts " + String.join(", ", allowed) + ")");
            }
            if (sections.containsKey(label)) {
                throw new IllegalArgumentException("section \"" + label + "\" is written twice");
            }
            i++;
            while (i < lines.size() && lines.get(i).isBlank()) {
                i++;
            }
            if (i >= lines.size() || !lines.get(i).trim().equals(FENCE_OPEN)) {
                throw new IllegalArgumentException("section \"" + label + "\" needs a ```json block after its label");
            }
            i++;
            List<String> value = new ArrayList<>();
            while (i < lines.size() && !lines.get(i).trim().equals(FENCE_CLOSE)) {
                value.add(lines.get(i));
                i++;
            }
            if (i >= lines.size()) {
                throw new IllegalArgumentException("section \"" + label + "\": the ```json block is not closed");
            }
            i++;
            String text = normalize(String.join("\n", value));
            if (text.isEmpty()) {
                throw new IllegalArgumentException("section \"" + label + "\" is empty");
            }
            sections.put(label, text);
        }
        if (sections.isEmpty()) {
            return "";
        }
        List<String> entries = new ArrayList<>();
        sections.forEach((label, value) -> entries.add("  \"" + label + "\": " + value));
        return "{\n" + String.join(",\n", entries) + "\n}";
    }

    /**
     * Splits the wire code (a JSON object, possibly with {@code {{bindings}}} in its values) into
     * its top-level keys and their raw value text. IllegalArgumentException when it is not one.
     */
    public static Map<String, String> split(String code) {
        String text = code.trim();
        if (!text.startsWith("{") || !text.endsWith("}")) {
            throw new IllegalArgumentException("not a JSON object");
        }
        Map<String, String> out = new LinkedHashMap<>();
        int end = text.length() - 1;
        int i = skipSpaces(text, 1, end);
        while (i < end) {
            if (text.charAt(i) != '"') {
                throw new IllegalArgumentException("expected a quoted key at " + i);
            }
            int keyEnd = stringEnd(text, i, end);
            String key = text.substring(i + 1, keyEnd);
            i = skipSpaces(text, keyEnd + 1, end);
            if (i >= end || text.charAt(i) != ':') {
                throw new IllegalArgumentException("expected ':' after \"" + key + "\"");
            }
            int valueEnd = valueEnd(text, i + 1, end);
            String value = text.substring(i + 1, valueEnd).trim();
            if (value.isEmpty()) {
                throw new IllegalArgumentException("\"" + key + "\" has no value");
            }
            if (out.put(key, value) != null) {
                throw new IllegalArgumentException("\"" + key + "\" is written twice");
            }
            i = skipSpaces(text, valueEnd + 1, end);
        }
        return out;
    }

    /** End (exclusive) of the value starting at {@code start}: the next top-level comma or {@code end}. */
    private static int valueEnd(String text, int start, int end) {
        int depth = 0;
        int j = start;
        while (j < end) {
            char ch = text.charAt(j);
            if (ch == '"') {
                j = stringEnd(text, j, end);
            } else if (ch == '{' || ch == '[') {
                depth++;
            } else if (ch == '}' || ch == ']') {
                depth--;
            } else if (ch == ',' && depth == 0) {
                break;
            }
            j++;
        }
        if (depth != 0) {
            throw new IllegalArgumentException("unbalanced value");
        }
        return j;
    }

    /** A section value as stored: trimmed, without blank lines. */
    private static String normalize(String value) {
        return value.lines().filter(l -> !l.isBlank()).reduce((a, b) -> a + "\n" + b).orElse("").trim();
    }

    private static int skipSpaces(String text, int i, int end) {
        while (i < end && Character.isWhitespace(text.charAt(i))) {
            i++;
        }
        return i;
    }

    /** Index of the closing quote of the string starting at {@code start}. */
    private static int stringEnd(String text, int start, int end) {
        for (int i = start + 1; i < end; i++) {
            char ch = text.charAt(i);
            if (ch == '\\') {
                i++;
            } else if (ch == '"') {
                return i;
            }
        }
        throw new IllegalArgumentException("unterminated string");
    }
}
