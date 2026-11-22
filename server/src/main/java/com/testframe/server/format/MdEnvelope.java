package com.testframe.server.format;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The envelope shared by every project file (see docs/project-format.md):
 * <pre>
 * -------------------
 * key: value
 * -------------------
 * body
 * </pre>
 * Code bodies are fenced Markdown blocks with a language ({@link #fence}/{@link #unfence});
 * documentation bodies (source docs, private data) are plain Markdown.
 */
public final class MdEnvelope {

    public static final String FRAME_SEP = "-------------------";

    private static final Pattern FIELD = Pattern.compile("([A-Za-z0-9_-]+):\\s?(.*)");
    private static final Pattern FENCE_OPEN = Pattern.compile("(`{3,})[A-Za-z0-9_-]*");

    /** Frontmatter fields (in file order; a repeated key keeps its last value) and the body. */
    public record Parsed(Map<String, String> fields, String body) {
    }

    private MdEnvelope() {
    }

    /**
     * Frontmatter = the lines between the first two {@link #FRAME_SEP} lines; the body is
     * everything after the closing one, without trailing newlines.
     */
    public static Parsed parse(String md) {
        String[] lines = (md == null ? "" : md).split("\\r?\\n", -1);
        Map<String, String> fields = new LinkedHashMap<>();
        int i = 0;
        if (lines.length > 0 && lines[0].equals(FRAME_SEP)) {
            i = 1;
            while (i < lines.length && !lines[i].equals(FRAME_SEP)) {
                Matcher m = FIELD.matcher(lines[i]);
                if (m.matches()) {
                    fields.put(m.group(1), m.group(2));
                }
                i++;
            }
            i++; // closing separator
        }
        String body = i < lines.length ? String.join("\n", java.util.Arrays.copyOfRange(lines, i, lines.length)) : "";
        return new Parsed(fields, stripTrailingNewlines(body));
    }

    /**
     * Renders fields in iteration order, omitting {@code null} and empty values. A non-empty
     * body (trailing newlines removed) ends with exactly one {@code \n}.
     */
    public static String render(Map<String, ?> fields, String body) {
        StringBuilder out = new StringBuilder(FRAME_SEP).append('\n');
        for (Map.Entry<String, ?> field : fields.entrySet()) {
            Object value = field.getValue();
            if (value != null && !String.valueOf(value).isEmpty()) {
                out.append(field.getKey()).append(": ").append(value).append('\n');
            }
        }
        out.append(FRAME_SEP).append('\n');
        String text = stripTrailingNewlines(body == null ? "" : body);
        if (!text.isEmpty()) {
            out.append(text).append('\n');
        }
        return out.toString();
    }

    /** An envelope with an empty frontmatter (private data). */
    public static String render(String body) {
        return render(Map.of(), body);
    }

    /**
     * Wraps code in a fenced block tagged with {@code lang} (empty code stays empty). The fence
     * is longer than any backtick run inside the code, so it can never close early.
     */
    public static String fence(String lang, String code) {
        String text = stripTrailingNewlines(code == null ? "" : code);
        if (text.isBlank()) {
            return "";
        }
        int longest = 0;
        Matcher ticks = Pattern.compile("`+").matcher(text);
        while (ticks.find()) {
            longest = Math.max(longest, ticks.group().length());
        }
        String marks = "`".repeat(Math.max(3, longest + 1));
        return marks + lang + "\n" + text + "\n" + marks;
    }

    /** The code inside a fenced block (body without a fence is returned as is). */
    public static String unfence(String body) {
        String text = stripTrailingNewlines(body == null ? "" : body);
        int firstBreak = text.indexOf('\n');
        if (firstBreak < 0) {
            return text;
        }
        Matcher open = FENCE_OPEN.matcher(text.substring(0, firstBreak));
        if (!open.matches() || !text.endsWith("\n" + open.group(1))) {
            return text;
        }
        int end = text.length() - open.group(1).length() - 1;
        return end <= firstBreak ? "" : text.substring(firstBreak + 1, end);
    }

    static String stripTrailingNewlines(String text) {
        int end = text.length();
        while (end > 0 && text.charAt(end - 1) == '\n') {
            end--;
        }
        return text.substring(0, end);
    }
}
