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
 * {@code {var-file}.private.md} (private data) and {@code {var-file}.cache.md} (last run).
 * The frontmatter stores only what the path cannot express; see docs/project-format.md.
 */
public final class CardCodec {

    public static final String CARD_SUFFIX = ".md";
    public static final String PRIVATE_SUFFIX = ".private.md";
    public static final String CACHE_SUFFIX = ".cache.md";

    private static final Pattern SOURCE_REF = Pattern.compile("([a-z]+)(?:/([a-z0-9][a-z0-9._-]*))?", Pattern.CASE_INSENSITIVE);
    private static final Pattern SIZE = Pattern.compile("\\d+x\\d+");
    private static final Pattern OPERATION_ID = Pattern.compile("[A-Za-z0-9_.-]+");
    private static final String OPENAPI = "openapi";
    private static final String MONGO = "mongo";
    private static final Pattern NUMBER = Pattern.compile("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?");
    private static final Pattern ENDPOINT = Pattern.compile("(GET|POST|PUT|PATCH|DELETE)\\s+(\\S+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern WHITESPACE = Pattern.compile("(?U)\\s+");

    /** A parsed card: {@code errors} non-empty means the file is invalid and {@code card} is null. */
    public record Parsed(Card card, List<String> errors, List<String> warnings) {
    }

    private CardCodec() {
    }

    // ------------------------------------------------------------------ cards

    /**
     * Renders a card; its code always lives in the card itself. The card's position in the
     * step is not stored here: it comes from the step's {@code flow.md}.
     */
    public static String render(Card card) {
        String subtype = Names.trim(card.subtype());
        String type = Catalog.cardTypeOf(sourceTypeOf(card), subtype);
        Catalog.Size size = Catalog.defaultSize(type);
        int width = card.width() == null ? size.width() : card.width();
        int height = card.height() == null ? size.height() : card.height();
        boolean customSize = width != size.width() || height != size.height();
        String code = card.code() == null ? "" : card.code();

        Map<String, Object> fields = new LinkedHashMap<>();
        String title = Names.trim(card.title());
        fields.put("title", title.isEmpty() ? card.varName() : title);
        fields.put("source", sourceRef(card));
        fields.put("subtype", subtype.isEmpty() ? null : subtype);
        String collection = card.collection() == null ? "" : card.collection();
        fields.put("collection", collection.isEmpty() ? null : collection);
        fields.put("endpoint", Names.trim(card.endpoint()));
        String openapiId = Names.trim(card.openapiId());
        fields.put("openapi-id", openapiId.isEmpty() ? null : openapiId);
        fields.put("timeout", card.timeout() == null ? Catalog.defaultTimeout(type) : card.timeout());
        fields.put("size", customSize ? width + "x" + height : null);
        fields.put("result-height", card.resultHeight());
        return MdEnvelope.render(fields, body(sourceTypeOf(card), subtype, code));
    }

    /** Parses a card file. {@code fileBase} is the var-file (no extension). */
    public static Parsed parse(String fileBase, String content) {
        MdEnvelope.Parsed md = MdEnvelope.parse(content);
        Map<String, String> f = md.fields();
        List<String> errors = validate(f);
        if (!errors.isEmpty()) {
            return new Parsed(null, errors, List.of());
        }
        String[] ref = f.get("source").split("/", -1);
        String sourceType = ref[0];
        String sourceName = ref.length > 1 ? ref[1] : "";
        String subtype = f.get("subtype");
        String type = Catalog.cardTypeOf(sourceType, subtype);
        Catalog.Size size = Catalog.defaultSize(type);
        Integer width = size.width();
        Integer height = size.height();
        if (f.containsKey("size")) {
            String[] wh = f.get("size").split("x");
            width = Integer.valueOf(wh[0]);
            height = Integer.valueOf(wh[1]);
        }
        String endpoint = f.getOrDefault("endpoint", "");
        String code = MdEnvelope.unfence(md.body());
        Card card = new Card(
                Names.fileNameToVarName(fileBase),
                f.get("title"),
                type,
                sourceType,
                subtype,
                f.get("collection"),
                sourceName,
                endpoint,
                f.get("openapi-id"),
                httpMethodOf(endpoint),
                f.containsKey("timeout") ? toInt(f.get("timeout")) : Catalog.defaultTimeout(type),
                width,
                height,
                f.containsKey("result-height") ? toInt(f.get("result-height")) : null,
                code,
                null,
                null);
        return new Parsed(card, List.of(), List.of());
    }

    /** Frontmatter schema of a card file: one {@code "key: problem"} per violation. */
    public static List<String> validate(Map<String, String> f) {
        List<String> errors = new ArrayList<>();
        String title = f.get("title");
        if (title == null || title.isEmpty()) {
            errors.add("title: required");
        }
        String source = f.get("source");
        String sourceType = null;
        if (source == null || source.isEmpty()) {
            errors.add("source: required ({type-source}/{name-source}, or rawvalue)");
        } else if (!SOURCE_REF.matcher(source).matches()) {
            errors.add("source: source must be {type-source} or {type-source}/{name-source}");
        } else if (!Catalog.SOURCE_TYPES.contains(source.split("/")[0])) {
            errors.add("source: unknown type-source");
        } else {
            sourceType = source.split("/")[0];
            if (!Catalog.hasSources(sourceType) && source.contains("/")) {
                errors.add("source: " + sourceType + " cards have no name-source (write source: " + sourceType + ")");
            }
        }
        String subtype = f.get("subtype");
        if (sourceType != null) {
            String problem = Catalog.subtypeProblem(sourceType, subtype);
            if (problem != null) {
                errors.add("subtype: " + problem);
            }
        }
        String collection = f.get("collection");
        if (MONGO.equals(sourceType)) {
            String problem = MongoCall.collectionProblem(collection);
            if (problem != null) {
                errors.add("collection: " + problem);
            }
        } else if (collection != null && sourceType != null) {
            errors.add("collection: only mongo cards name a collection");
        }
        String openapiId = f.get("openapi-id");
        if (openapiId != null && sourceType != null && !OPENAPI.equals(sourceType)) {
            errors.add("openapi-id: only openapi cards name a spec operation");
        } else if (openapiId != null && !OPERATION_ID.matcher(openapiId).matches()) {
            errors.add("openapi-id: must be the spec's operationId (letters, digits, _ . -)");
        }
        if (f.containsKey("script")) {
            errors.add("script: sources have no scripts; the card holds its own code");
        }
        intProblem(f, "timeout", false, 100, 120_000).ifPresent(errors::add);
        if (f.containsKey("size") && !SIZE.matcher(f.get("size")).matches()) {
            errors.add("size: size must be {width}x{height}");
        }
        intProblem(f, "result-height", false, 24, 600).ifPresent(errors::add);
        return errors;
    }

    /**
     * {@code source:} reference, e.g. mongo/products-db, or the type alone for sourceless
     * types ({@code rawvalue}, {@code jsonassert});
     * every card declares one, so a card without a type is rejected on save.
     */
    public static String sourceRef(Card card) {
        String type = Names.trim(card.sourceType());
        if (type.isEmpty()) {
            return null;
        }
        if (!Catalog.hasSources(type)) {
            return type; // rawvalue, jsonassert: the type alone
        }
        String name = Names.trim(card.sourceName());
        return name.isEmpty() ? type : type + "/" + name;
    }

    /**
     * The body of a card file: one fenced block in the (type, subtype) language. A mongo card's
     * array of call arguments is stored in its canonical format ({@link MongoJson}); a draft that
     * does not format is kept as written (the code rule reports why on save).
     */
    private static String body(String sourceType, String subtype, String code) {
        if (MONGO.equals(sourceType)) {
            String formatted = MongoJson.format(code);
            if (formatted != null) {
                return MdEnvelope.fence(Catalog.languageOf(sourceType, subtype), formatted);
            }
        }
        return MdEnvelope.fence(Catalog.languageOf(sourceType, subtype), code);
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
        String raw = f.getOrDefault("status", "");
        String status = List.of("success", "error", "skipped").contains(raw) ? raw : "idle";
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
