package com.testframe.server.format;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardRun;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * One card file ({@code frames/{frame}/step-{n}/{var-file}.md}) and its siblings:
 * {@code {var-file}.private.md} (private data) and {@code {var-file}.result-data.md} (last run).
 * The frontmatter stores only what the path cannot express; see docs/project-format.md.
 */
public final class CardCodec {

    public static final String CARD_SUFFIX = ".md";
    public static final String PRIVATE_SUFFIX = ".private.md";
    public static final String PRIVATE_EXAMPLE_SUFFIX = ".private.example.md";
    public static final String RESULT_SUFFIX = ".result-data.md";

    private static final Pattern SOURCE_REF = Pattern.compile("([a-z]+)(?:/([a-z0-9][a-z0-9._-]*))?", Pattern.CASE_INSENSITIVE);
    private static final Pattern SIZE = Pattern.compile("\\d+x\\d+");
    private static final Pattern NUMBER = Pattern.compile("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?");
    private static final Pattern ENDPOINT = Pattern.compile("(GET|POST|PUT|PATCH|DELETE)\\s+(\\S+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern WHITESPACE = Pattern.compile("(?U)\\s+");

    /** A parsed card: {@code errors} non-empty means the file is invalid and {@code card} is null. */
    public record Parsed(Card card, int order, List<String> errors, List<String> warnings) {
    }

    private CardCodec() {
    }

    // ------------------------------------------------------------------ cards

    /**
     * Renders a card at position {@code order}. {@code scriptBody} is the body of the card's
     * source script (when it exists): a card whose code still matches it stores an empty body.
     */
    public static String render(Card card, int order, Optional<String> scriptBody) {
        String type = Catalog.cardTypeOf(sourceTypeOf(card));
        Catalog.Size size = Catalog.defaultSize(type);
        int width = card.width() == null ? size.width() : card.width();
        int height = card.height() == null ? size.height() : card.height();
        boolean customSize = width != size.width() || height != size.height();
        String code = card.code() == null ? "" : card.code();
        boolean inherits = scriptBody.isPresent() && Names.trim(code).equals(Names.trim(scriptBody.get()));

        Map<String, Object> fields = new LinkedHashMap<>();
        String title = Names.trim(card.title());
        fields.put("title", title.isEmpty() ? card.varName() : title);
        fields.put("order", order);
        fields.put("source", sourceRef(card));
        fields.put("script", card.script());
        fields.put("endpoint", Names.trim(card.endpoint()));
        fields.put("timeout", card.timeout() == null ? Catalog.defaultTimeout(type) : card.timeout());
        fields.put("size", customSize ? width + "x" + height : null);
        fields.put("result-height", card.resultHeight());
        return MdEnvelope.render(fields, inherits ? "" : MdEnvelope.fence(Catalog.languageOf(sourceTypeOf(card)), code));
    }

    /**
     * Parses a card file. {@code fileBase} is the var-file (no extension); an empty body of a
     * card bound to a source script is filled from {@code scripts} (warning when it is missing).
     */
    public static Parsed parse(String fileBase, String content, ScriptLookup scripts) {
        MdEnvelope.Parsed md = MdEnvelope.parse(content);
        Map<String, String> f = md.fields();
        List<String> errors = validate(f);
        if (!errors.isEmpty()) {
            return new Parsed(null, 0, errors, List.of());
        }
        String[] ref = f.getOrDefault("source", "inline").split("/", -1);
        String sourceType = ref[0];
        String sourceName = ref.length > 1 ? ref[1] : "";
        String type = Catalog.cardTypeOf(sourceType);
        Catalog.Size size = Catalog.defaultSize(type);
        Integer width = size.width();
        Integer height = size.height();
        if (f.containsKey("size")) {
            String[] wh = f.get("size").split("x");
            width = Integer.valueOf(wh[0]);
            height = Integer.valueOf(wh[1]);
        }
        String endpoint = f.getOrDefault("endpoint", "");
        String script = f.get("script");
        String code = MdEnvelope.unfence(md.body());
        List<String> warnings = new ArrayList<>();
        if (script != null) {
            Optional<String> body = scripts.body(sourceType, sourceName, script);
            if (body.isEmpty()) {
                warnings.add("script \"%s\" not found in source %s".formatted(script, f.get("source")));
            } else if (Names.trim(code).isEmpty()) {
                code = MdEnvelope.stripTrailingNewlines(body.get());
            }
        }
        Card card = new Card(
                Names.fileNameToVarName(fileBase),
                f.get("title"),
                type,
                toInt(f.get("order")),
                sourceType,
                sourceName,
                script,
                endpoint,
                httpMethodOf(endpoint),
                f.containsKey("timeout") ? toInt(f.get("timeout")) : Catalog.defaultTimeout(type),
                width,
                height,
                f.containsKey("result-height") ? toInt(f.get("result-height")) : null,
                code,
                null,
                null);
        return new Parsed(card, card.order(), List.of(), warnings);
    }

    /** Frontmatter schema of a card file: one {@code "key: problem"} per violation. */
    public static List<String> validate(Map<String, String> f) {
        List<String> errors = new ArrayList<>();
        String title = f.get("title");
        if (title == null || title.isEmpty()) {
            errors.add("title: required");
        }
        intProblem(f, "order", true, 1, Integer.MAX_VALUE).ifPresent(errors::add);
        String source = f.get("source");
        if (source != null) {
            if (!SOURCE_REF.matcher(source).matches()) {
                errors.add("source: source must be {type-source} or {type-source}/{name-source}");
            } else if (!Catalog.SOURCE_TYPES.contains(source.split("/")[0])) {
                errors.add("source: unknown type-source");
            }
        }
        String script = f.get("script");
        if (script != null) {
            String problem = Names.camelNameProblem("script", script);
            if (problem != null) {
                errors.add("script: " + problem);
            }
        }
        intProblem(f, "timeout", false, 100, 120_000).ifPresent(errors::add);
        if (f.containsKey("size") && !SIZE.matcher(f.get("size")).matches()) {
            errors.add("size: size must be {width}x{height}");
        }
        intProblem(f, "result-height", false, 24, 600).ifPresent(errors::add);
        if (errors.isEmpty() && script != null && (source == null || !source.contains("/"))) {
            errors.add("script: script requires source: {type-source}/{name-source}");
        }
        return errors;
    }

    /** {@code source:} reference, e.g. mongo/products-db; inline cards carry none. */
    public static String sourceRef(Card card) {
        String type = Names.trim(card.sourceType());
        if (type.isEmpty() || "inline".equals(type)) {
            return null;
        }
        String name = Names.trim(card.sourceName());
        return name.isEmpty() ? type : type + "/" + name;
    }

    /** HTTP method of an endpoint written as {@code METHOD /path}, or "". */
    public static String httpMethodOf(String endpoint) {
        Matcher m = ENDPOINT.matcher(Names.trim(endpoint));
        return m.matches() ? m.group(1).toUpperCase(Locale.ROOT) : "";
    }

    private static String sourceTypeOf(Card card) {
        return Names.trim(card.sourceType());
    }

    // ------------------------------------------------------------ siblings

    public static String renderPrivate(String data) {
        return MdEnvelope.render(data);
    }

    public static String parsePrivate(String content) {
        return MdEnvelope.parse(content).body();
    }

    /** {@code status}, {@code ran-at}, {@code elapsed}, one-line {@code summary}; body = output. */
    public static String renderResult(CardRun result) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("status", result.status());
        fields.put("ran-at", result.ranAt());
        fields.put("elapsed", result.at());
        fields.put("summary", result.text() == null ? null : WHITESPACE.matcher(result.text()).replaceAll(" "));
        String output = result.output() == null ? "" : result.output();
        String trimmed = output.strip();
        boolean json = trimmed.startsWith("{") || trimmed.startsWith("[");
        return MdEnvelope.render(fields, MdEnvelope.fence(json ? "json" : "text", output));
    }

    public static CardRun parseResult(String content) {
        MdEnvelope.Parsed md = MdEnvelope.parse(content);
        Map<String, String> f = md.fields();
        String status = "success".equals(f.get("status")) || "error".equals(f.get("status")) ? f.get("status") : "idle";
        return new CardRun(status, f.getOrDefault("summary", ""), MdEnvelope.unfence(md.body()), f.getOrDefault("elapsed", ""), f.get("ran-at"));
    }

    // -------------------------------------------------------------- numbers

    private static Optional<String> intProblem(Map<String, String> f, String key, boolean required, int min, int max) {
        if (!f.containsKey(key)) {
            return required ? Optional.of(key + ": required") : Optional.empty();
        }
        Integer value = toInt(f.get(key));
        if (value == null) {
            return Optional.of(key + ": expected an integer");
        }
        if (value < min || value > max) {
            return Optional.of(key + (value < min ? ": must be >= " + min : ": must be <= " + max));
        }
        return Optional.empty();
    }

    /** JS {@code Number(text)} restricted to integers: "" → 0, "1e3" → 1000, otherwise null. */
    static Integer toInt(String text) {
        String t = Names.trim(text);
        if (t.isEmpty()) {
            return 0;
        }
        if (!NUMBER.matcher(t).matches()) {
            return null;
        }
        try {
            return new BigDecimal(t).intValueExact();
        } catch (ArithmeticException e) {
            return null;
        }
    }
}
