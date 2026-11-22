package com.testframe.server.format;

import com.mongodb.client.model.Collation;
import com.mongodb.client.model.CollationAlternate;
import com.mongodb.client.model.CollationCaseFirst;
import com.mongodb.client.model.CollationMaxVariable;
import com.mongodb.client.model.CollationStrength;
import org.bson.BsonDocument;
import org.bson.BsonValue;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A mongo card's query: the collection (the card's {@code collection:} frontmatter) and its
 * body, one JSON object keyed by the subtype's sections (spec: docs/project-format.md, "Mongo
 * cards"; on disk each section is a label line + a ```json block, see {@link MongoSections}).
 * <pre>
 *   find:        filter, projection, sort (objects), limit, skip (integers >= 0),
 *                maxTimeMS (integer >= 0), collation (object), hint (index name or object), comment (string)
 *   aggregation: aggregation (the pipeline: array of stages, required), allowDiskUse (boolean),
 *                maxTimeMS (integer >= 0), batchSize (integer >= 1), collation, hint, comment, let (object)
 * </pre>
 * Unknown keys (including {@code collection}, which lives in the frontmatter) and write stages
 * ({@code $out}, {@code $merge}) are rejected. Values use JSON (MongoDB extended JSON such as
 * {"$oid": "..."} is understood).
 */
public record MongoQuery(String subtype, String collection, BsonDocument filter, BsonDocument projection,
                         BsonDocument sort, Integer limit, Integer skip, List<BsonDocument> pipeline,
                         Options options) {

    /** The driver options shared by find and aggregate (null = not set). */
    public record Options(Integer maxTimeMS, Integer batchSize, Boolean allowDiskUse, Collation collation,
                          BsonValue hint, String comment, BsonDocument let) {
    }

    public static final String FIND = "find";
    public static final String AGGREGATION = "aggregation";

    /**
     * One body section: {@code kind} is object, array, integer (>= 0), positiveInteger, boolean,
     * string or hint (string or object); {@code option} marks the command options the editor
     * groups apart.
     */
    public record Section(String name, String kind, boolean required, boolean option) {
    }

    public static final List<Section> FIND_SECTIONS = List.of(
            new Section("filter", "object", false, false), new Section("projection", "object", false, false),
            new Section("sort", "object", false, false), new Section("limit", "integer", false, false),
            new Section("skip", "integer", false, false), new Section("maxTimeMS", "integer", false, true),
            new Section("collation", "object", false, true), new Section("hint", "hint", false, true),
            new Section("comment", "string", false, true));
    public static final List<Section> AGGREGATION_SECTIONS = List.of(
            new Section("aggregation", "array", true, false), new Section("allowDiskUse", "boolean", false, true),
            new Section("maxTimeMS", "integer", false, true), new Section("batchSize", "positiveInteger", false, true),
            new Section("collation", "object", false, true), new Section("hint", "hint", false, true),
            new Section("comment", "string", false, true), new Section("let", "object", false, true));
    public static final List<String> FIND_KEYS = FIND_SECTIONS.stream().map(Section::name).toList();
    public static final List<String> AGGREGATION_KEYS = AGGREGATION_SECTIONS.stream().map(Section::name).toList();
    public static final List<String> WRITE_STAGES = List.of("$out", "$merge");

    /** The body sections of a subtype, in canonical order (empty for an unknown one). */
    public static List<Section> sectionsOf(String subtype) {
        return switch (subtype == null ? "" : subtype) {
            case FIND -> FIND_SECTIONS;
            case AGGREGATION -> AGGREGATION_SECTIONS;
            default -> List.of();
        };
    }

    private static final JsonMapper STRICT = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build();
    private static final Pattern QUOTED_BINDING = Pattern.compile("\"\\{\\{[^}]+\\}\\}\"");
    private static final Pattern BINDING = Pattern.compile("\\{\\{[^}]+\\}\\}");
    private static final List<String> COLLATION_KEYS = List.of("locale", "caseLevel", "caseFirst", "strength",
            "numericOrdering", "alternate", "maxVariable", "normalization", "backwards");

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
            read(subtype, null, probe, true);
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
     * resolved (a blank body has no sections); throws IllegalArgumentException with the reason.
     */
    public static MongoQuery parse(String subtype, String collection, String json) {
        if (subtype == null || subtype.isBlank()) {
            throw new IllegalArgumentException("mongo cards need a subtype (" + FIND + ", " + AGGREGATION + ")");
        }
        String problem = collectionProblem(collection);
        if (problem != null) {
            throw new IllegalArgumentException("collection: " + problem);
        }
        return read(subtype, collection, json == null || json.isBlank() ? "{}" : json, false);
    }

    /** {@code lenient}: null values (bindings in the code rule) are accepted for any key. */
    private static MongoQuery read(String subtype, String collection, String json, boolean lenient) {
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
        List<Section> sections = sectionsOf(subtype);
        if (sections.isEmpty()) {
            throw new IllegalArgumentException("unknown mongo subtype \"" + subtype + "\" (" + FIND + ", " + AGGREGATION + ")");
        }
        List<String> allowed = sections.stream().map(Section::name).toList();
        for (String key : doc.keySet()) {
            if (!allowed.contains(key)) {
                throw new IllegalArgumentException("unknown key \"" + key + "\" (" + subtype + " accepts " + String.join(", ", allowed) + ")");
            }
        }
        String writeStage = writeStageIn(doc);
        if (writeStage != null) {
            throw new IllegalArgumentException("write stage \"" + writeStage + "\" is not allowed (mongo cards are read-only)");
        }
        for (Section section : sections) {
            BsonValue value = doc.get(section.name());
            if (value == null) {
                if (section.required()) {
                    throw new IllegalArgumentException(section.name() + " is required, e.g. " + shapeHint(subtype));
                }
            } else if (!(lenient && value.isNull())) {
                checkKind(section, value);
            }
        }

        Options options = new Options(integer(doc, "maxTimeMS"), integer(doc, "batchSize"), bool(doc, "allowDiskUse"),
                doc.isDocument("collation") ? collationOf(doc.getDocument("collation")) : null,
                present(doc, "hint") ? doc.get("hint") : null,
                doc.isString("comment") ? doc.getString("comment").getValue() : null,
                doc.isDocument("let") ? doc.getDocument("let") : null);
        if (FIND.equals(subtype)) {
            return new MongoQuery(subtype, collection, document(doc, "filter"), document(doc, "projection"),
                    document(doc, "sort"), integer(doc, "limit"), integer(doc, "skip"), List.of(), options);
        }
        List<BsonDocument> stages = new ArrayList<>();
        if (doc.isArray("aggregation")) {
            for (BsonValue stage : doc.getArray("aggregation")) {
                if (stage.isDocument()) {
                    stages.add(stage.asDocument());
                }
            }
        }
        return new MongoQuery(subtype, collection, null, null, null, null, null, stages, options);
    }

    private static void checkKind(Section section, BsonValue value) {
        String name = section.name();
        switch (section.kind()) {
            case "object" -> {
                if (!value.isDocument()) {
                    throw new IllegalArgumentException(name + " must be an object");
                }
                if ("collation".equals(name)) {
                    collationOf(value.asDocument());
                }
            }
            case "array" -> {
                if (!value.isArray()) {
                    throw new IllegalArgumentException(name + " must be an array of stages (the pipeline)");
                }
                if (value.asArray().isEmpty()) {
                    throw new IllegalArgumentException("an aggregation needs at least one stage");
                }
                for (int i = 0; i < value.asArray().size(); i++) {
                    BsonValue stage = value.asArray().get(i);
                    if (!stage.isDocument() && !stage.isNull()) {
                        throw new IllegalArgumentException(name + " stage " + (i + 1) + " must be an object");
                    }
                }
            }
            case "integer", "positiveInteger" -> {
                int min = "integer".equals(section.kind()) ? 0 : 1;
                if (!value.isNumber() || value.asNumber().doubleValue() < min
                        || value.asNumber().doubleValue() != Math.rint(value.asNumber().doubleValue())
                        || value.asNumber().doubleValue() > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException(name + " must be " + (min == 0 ? "a non-negative" : "a positive") + " integer");
                }
            }
            case "boolean" -> {
                if (!value.isBoolean()) {
                    throw new IllegalArgumentException(name + " must be true or false");
                }
            }
            case "string" -> {
                if (!value.isString()) {
                    throw new IllegalArgumentException(name + " must be a string");
                }
            }
            case "hint" -> {
                if (!value.isString() && !value.isDocument()) {
                    throw new IllegalArgumentException(name + " must be an index name (string) or an index key object");
                }
            }
            default -> throw new IllegalStateException("unknown section kind " + section.kind());
        }
    }

    /** The driver collation of a {@code collation} section; IllegalArgumentException names a bad key or value. */
    public static Collation collationOf(BsonDocument doc) {
        for (String key : doc.keySet()) {
            if (!COLLATION_KEYS.contains(key)) {
                throw new IllegalArgumentException("unknown collation key \"" + key + "\" (" + String.join(", ", COLLATION_KEYS) + ")");
            }
        }
        if (!doc.isString("locale")) {
            throw new IllegalArgumentException("collation needs a locale, e.g. {\"locale\": \"pt\"}");
        }
        try {
            Collation.Builder b = Collation.builder().locale(doc.getString("locale").getValue());
            if (doc.containsKey("caseLevel")) {
                b.caseLevel(doc.getBoolean("caseLevel").getValue());
            }
            if (doc.containsKey("caseFirst")) {
                b.collationCaseFirst(CollationCaseFirst.fromString(doc.getString("caseFirst").getValue()));
            }
            if (doc.containsKey("strength")) {
                b.collationStrength(CollationStrength.fromInt(doc.getNumber("strength").intValue()));
            }
            if (doc.containsKey("numericOrdering")) {
                b.numericOrdering(doc.getBoolean("numericOrdering").getValue());
            }
            if (doc.containsKey("alternate")) {
                b.collationAlternate(CollationAlternate.fromString(doc.getString("alternate").getValue()));
            }
            if (doc.containsKey("maxVariable")) {
                b.collationMaxVariable(CollationMaxVariable.fromString(doc.getString("maxVariable").getValue()));
            }
            if (doc.containsKey("normalization")) {
                b.normalization(doc.getBoolean("normalization").getValue());
            }
            if (doc.containsKey("backwards")) {
                b.backwards(doc.getBoolean("backwards").getValue());
            }
            return b.build();
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("invalid collation: " + e.getMessage());
        }
    }

    private static boolean present(BsonDocument doc, String key) {
        return doc.containsKey(key) && !doc.get(key).isNull();
    }

    private static BsonDocument document(BsonDocument doc, String key) {
        return doc.isDocument(key) ? doc.getDocument(key) : new BsonDocument();
    }

    private static Integer integer(BsonDocument doc, String key) {
        return doc.isNumber(key) ? doc.getNumber(key).intValue() : null;
    }

    private static Boolean bool(BsonDocument doc, String key) {
        return doc.isBoolean(key) ? doc.getBoolean(key).getValue() : null;
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
                ? "mongo aggregation bodies are one JSON object: {\"aggregation\": [{\"$match\": {\"ativo\": true}}]}"
                : "mongo find bodies are one JSON object: {\"filter\": {\"ativo\": true}}";
    }
}
