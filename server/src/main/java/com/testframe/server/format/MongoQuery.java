package com.testframe.server.format;

import org.bson.BsonArray;
import org.bson.BsonDocument;
import org.bson.BsonValue;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A mongo card's query: the collection (the card's {@code collection:} frontmatter) and its
 * body, one JSON object whose shape follows the card's subtype (spec: docs/project-format.md,
 * "Mongo cards").
 * <pre>
 *   find:        {"filter": {...}, "projection": {...}, "sort": {...}, "limit": 10, "skip": 0}  (all optional)
 *   aggregation: {"pipeline": [{"$match": {...}}, ...]}
 * </pre>
 * Unknown keys (including {@code collection}, which lives in the frontmatter) and write stages
 * ({@code $out}, {@code $merge}) are rejected. Values use JSON (MongoDB extended JSON such as
 * {"$oid": "..."} is understood).
 */
public record MongoQuery(String subtype, String collection, BsonDocument filter, BsonDocument projection,
                         BsonDocument sort, Integer limit, Integer skip, List<BsonDocument> pipeline) {

    public static final String FIND = "find";
    public static final String AGGREGATION = "aggregation";
    public static final List<String> FIND_KEYS = List.of("filter", "projection", "sort", "limit", "skip");
    public static final List<String> AGGREGATION_KEYS = List.of("pipeline");
    public static final List<String> WRITE_STAGES = List.of("$out", "$merge");

    private static final JsonMapper STRICT = JsonMapper.builder().build();
    private static final Pattern QUOTED_BINDING = Pattern.compile("\"\\{\\{[^}]+\\}\\}\"");
    private static final Pattern BINDING = Pattern.compile("\\{\\{[^}]+\\}\\}");

    /**
     * The code rule of a mongo body, or null when acceptable. Empty code is a draft;
     * {@code {{bindings}}} stand for any value (they are resolved at run time). Without a
     * subtype there is no rule to apply yet (the missing subtype is reported by the card
     * validation).
     */
    public static String problem(String subtype, String code) {
        if (code == null || code.isBlank() || subtype == null || subtype.isBlank()) {
            return null;
        }
        String probe = BINDING.matcher(QUOTED_BINDING.matcher(code).replaceAll("null")).replaceAll("null");
        try {
            read(subtype, probe, true);
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    /**
     * Problem of a collection name (the card's {@code collection:}), or null: non-empty, no
     * {@code $}, no null character, not a {@code system.} collection.
     */
    public static String collectionProblem(String collection) {
        if (collection == null || collection.isBlank()) {
            return "required on mongo cards (the collection the query reads)";
        }
        if (!collection.equals(collection.trim()) || collection.contains("$") || collection.indexOf('\0') >= 0) {
            return "\"" + collection + "\" is not a collection name (no $, no spaces around, no null character)";
        }
        if (collection.startsWith("system.")) {
            return "system collections cannot be queried";
        }
        return null;
    }

    /**
     * Parses a card's query: its {@code collection} and a body whose bindings are already
     * resolved (a blank find body means no filter); throws IllegalArgumentException with the reason.
     */
    public static MongoQuery parse(String subtype, String collection, String json) {
        if (subtype == null || subtype.isBlank()) {
            throw new IllegalArgumentException("mongo cards need a subtype (" + FIND + ", " + AGGREGATION + ")");
        }
        String problem = collectionProblem(collection);
        if (problem != null) {
            throw new IllegalArgumentException("collection: " + problem);
        }
        String body = json == null || json.isBlank() ? (FIND.equals(subtype) ? "{}" : "") : json;
        MongoQuery q = read(subtype, body, false);
        return new MongoQuery(q.subtype(), collection, q.filter(), q.projection(), q.sort(),
                q.limit(), q.skip(), q.pipeline());
    }

    /** {@code lenient}: null values (bindings in the code rule) are accepted for any key. */
    private static MongoQuery read(String subtype, String json, boolean lenient) {
        try {
            if (!STRICT.readTree(json).isObject()) {
                throw new IllegalArgumentException(shapeHint(subtype));
            }
        } catch (JacksonException e) {
            throw new IllegalArgumentException("invalid JSON: " + e.getOriginalMessage());
        }
        BsonDocument doc;
        try {
            doc = BsonDocument.parse(json);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("invalid JSON: " + e.getMessage());
        }
        String sub = subtype;
        List<String> allowed = switch (sub) {
            case FIND -> FIND_KEYS;
            case AGGREGATION -> AGGREGATION_KEYS;
            default -> throw new IllegalArgumentException("unknown mongo subtype \"" + sub + "\" (" + FIND + ", " + AGGREGATION + ")");
        };
        for (String key : doc.keySet()) {
            if (!allowed.contains(key)) {
                throw new IllegalArgumentException("unknown key \"" + key + "\" (" + sub + " accepts " + String.join(", ", allowed) + ")");
            }
        }
        String writeStage = writeStageIn(doc);
        if (writeStage != null) {
            throw new IllegalArgumentException("write stage \"" + writeStage + "\" is not allowed (mongo cards are read-only)");
        }
        String name = null; // the collection comes from the card's frontmatter (see parse)

        if (FIND.equals(sub)) {
            return new MongoQuery(sub, name,
                    document(doc, "filter", lenient), document(doc, "projection", lenient), document(doc, "sort", lenient),
                    count(doc, "limit", lenient), count(doc, "skip", lenient), List.of());
        }
        BsonValue pipeline = doc.get("pipeline");
        if (pipeline == null) {
            throw new IllegalArgumentException("pipeline is required, e.g. " + shapeHint(sub));
        }
        if (lenient && pipeline.isNull()) {
            return new MongoQuery(sub, name, null, null, null, null, null, List.of());
        }
        if (!pipeline.isArray()) {
            throw new IllegalArgumentException("pipeline must be an array of stages");
        }
        List<BsonDocument> stages = new ArrayList<>();
        BsonArray array = pipeline.asArray();
        for (int i = 0; i < array.size(); i++) {
            BsonValue stage = array.get(i);
            if (stage.isDocument()) {
                stages.add(stage.asDocument());
            } else if (!(lenient && stage.isNull())) {
                throw new IllegalArgumentException("pipeline stage " + (i + 1) + " must be an object");
            }
        }
        return new MongoQuery(sub, name, null, null, null, null, null, stages);
    }

    private static BsonDocument document(BsonDocument doc, String key, boolean lenient) {
        BsonValue value = doc.get(key);
        if (value == null || (lenient && value.isNull())) {
            return new BsonDocument();
        }
        if (!value.isDocument()) {
            throw new IllegalArgumentException(key + " must be an object");
        }
        return value.asDocument();
    }

    private static Integer count(BsonDocument doc, String key, boolean lenient) {
        BsonValue value = doc.get(key);
        if (value == null || (lenient && value.isNull())) {
            return null;
        }
        if (value.isNumber() && value.asNumber().doubleValue() >= 0
                && value.asNumber().doubleValue() == Math.rint(value.asNumber().doubleValue())
                && value.asNumber().doubleValue() <= Integer.MAX_VALUE) {
            return value.asNumber().intValue();
        }
        throw new IllegalArgumentException(key + " must be a non-negative integer");
    }

    /** The first write stage key found anywhere in the body (nested pipelines included), or null. */
    private static String writeStageIn(BsonValue value) {
        if (value.isDocument()) {
            for (Map.Entry<String, BsonValue> e : value.asDocument().entrySet()) {
                if (WRITE_STAGES.contains(e.getKey())) {
                    return e.getKey();
                }
                String nested = writeStageIn(e.getValue());
                if (nested != null) {
                    return nested;
                }
            }
        } else if (value.isArray()) {
            for (BsonValue item : value.asArray()) {
                String nested = writeStageIn(item);
                if (nested != null) {
                    return nested;
                }
            }
        }
        return null;
    }

    private static String shapeHint(String subtype) {
        return AGGREGATION.equals(subtype)
                ? "mongo aggregation bodies are one JSON object: {\"pipeline\": [{\"$match\": {\"ativo\": true}}]}"
                : "mongo find bodies are one JSON object: {\"filter\": {\"ativo\": true}}";
    }
}
