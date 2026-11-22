package com.testframe.server.runner;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.AggregateIterable;
import com.mongodb.client.FindIterable;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.testframe.server.format.MongoCall;
import jakarta.annotation.PreDestroy;
import com.mongodb.client.model.DeleteOptions;
import com.mongodb.client.model.InsertManyOptions;
import com.mongodb.client.model.InsertOneOptions;
import com.mongodb.client.model.UpdateOptions;
import com.mongodb.client.result.DeleteResult;
import com.mongodb.client.result.InsertManyResult;
import com.mongodb.client.result.InsertOneResult;
import com.mongodb.client.result.UpdateResult;
import org.bson.BsonDocument;
import org.bson.BsonValue;
import org.bson.Document;
import org.bson.json.JsonMode;
import org.bson.json.JsonWriterSettings;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.SimpleMongoClientDatabaseFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Executes a mongo card's call ({@link MongoCall}: find, aggregation, deleteOne/Many,
 * updateOne/Many, insertOne/Many) with the MongoDB driver against the database named in the
 * source's base-url (e.g. mongodb://localhost:27017/products). One client per base-url, created
 * on first use. {@link MongoCall} validates the call (guards included) before anything connects.
 */
@Service
public class MongoRunner {

    public static final int MAX_DOCUMENTS = 1000;

    private static final JsonWriterSettings JSON = JsonWriterSettings.builder()
            .outputMode(JsonMode.RELAXED)
            .objectIdConverter((id, writer) -> writer.writeString(id.toHexString()))
            .build();

    private final Map<String, SimpleMongoClientDatabaseFactory> factories = new ConcurrentHashMap<>();

    /** Result as a JSON string: {"operation" (the subtype), "collection", "count", "result"}. */
    public String run(String uri, MongoCall call, long timeoutMs) {
        return envelope(call, execute(template(uri).getCollection(call.collection()), call, timeoutMs));
    }

    /**
     * Runs the call on {@code collection}: reads return the documents (at most
     * {@link #MAX_DOCUMENTS}), writes their counts ({@code deletedCount}; {@code matchedCount},
     * {@code modifiedCount}, {@code upsertedId}; {@code insertedId}; {@code insertedIds},
     * {@code insertedCount}). ObjectIds come out as hex strings.
     */
    static Object execute(MongoCollection<Document> collection, MongoCall call, long timeoutMs) {
        return switch (call.subtype()) {
            case MongoCall.FIND -> applyFind(collection.find(call.filter()), call, timeoutMs).into(new ArrayList<>());
            case MongoCall.AGGREGATION -> {
                List<Document> docs = applyAggregate(collection.aggregate(call.pipeline()), call, timeoutMs)
                        .into(new ArrayList<>());
                yield docs.size() > MAX_DOCUMENTS ? docs.subList(0, MAX_DOCUMENTS) : docs;
            }
            case MongoCall.DELETE_ONE -> deleted(collection.deleteOne(call.filter(), deleteOptions(call)));
            case MongoCall.DELETE_MANY -> deleted(collection.deleteMany(call.filter(), deleteOptions(call)));
            case MongoCall.UPDATE_ONE -> updated(call.update().isArray()
                    ? collection.updateOne(call.filter(), stages(call), updateOptions(call))
                    : collection.updateOne(call.filter(), call.update().asDocument(), updateOptions(call)));
            case MongoCall.UPDATE_MANY -> updated(call.update().isArray()
                    ? collection.updateMany(call.filter(), stages(call), updateOptions(call))
                    : collection.updateMany(call.filter(), call.update().asDocument(), updateOptions(call)));
            case MongoCall.INSERT_ONE -> {
                InsertOneResult r = collection.insertOne(document(call.documents().getFirst()), insertOneOptions(call));
                yield new Document("insertedId", id(r.getInsertedId()));
            }
            case MongoCall.INSERT_MANY -> {
                InsertManyResult r = collection.insertMany(call.documents().stream().map(MongoRunner::document).toList(),
                        insertManyOptions(call));
                List<Object> ids = new ArrayList<>();
                r.getInsertedIds().keySet().stream().sorted().forEach(i -> ids.add(id(r.getInsertedIds().get(i))));
                yield new Document("insertedIds", ids).append("insertedCount", ids.size());
            }
            default -> throw new IllegalArgumentException("unknown mongo subtype \"" + call.subtype() + "\"");
        };
    }

    private static String envelope(MongoCall call, Object result) {
        int count = result instanceof List<?> list ? list.size()
                : result instanceof Document d ? countOf(d) : 0;
        return new Document("operation", call.subtype())
                .append("collection", call.collection())
                .append("count", count)
                .append("result", result)
                .toJson(JSON);
    }

    private static int countOf(Document result) {
        for (String key : List.of("deletedCount", "modifiedCount", "insertedCount")) {
            if (result.get(key) instanceof Number n) {
                return n.intValue();
            }
        }
        return result.containsKey("insertedId") ? 1 : 0;
    }

    /**
     * The find arguments and options on the driver's {@link FindIterable}: projection, sort,
     * skip, limit (at most {@link #MAX_DOCUMENTS}), maxTime (the card timeout, or maxTimeMS when
     * lower), collation, hint (index name or keys) and comment.
     */
    static <T> FindIterable<T> applyFind(FindIterable<T> find, MongoCall c, long timeoutMs) {
        Integer limit = c.intOption("limit");
        FindIterable<T> it = find.limit(limit == null ? MAX_DOCUMENTS : Math.min(MAX_DOCUMENTS, limit))
                .maxTime(maxTime(c, timeoutMs), TimeUnit.MILLISECONDS);
        if (c.projection() != null) {
            it = it.projection(c.projection());
        }
        if (c.documentOption("sort") != null) {
            it = it.sort(c.documentOption("sort"));
        }
        if (c.intOption("skip") != null) {
            it = it.skip(c.intOption("skip"));
        }
        if (c.collationOption() != null) {
            it = it.collation(c.collationOption());
        }
        BsonValue hint = c.hintOption();
        if (hint != null) {
            it = hint.isString() ? it.hintString(hint.asString().getValue()) : it.hint(hint.asDocument());
        }
        if (c.stringOption("comment") != null) {
            it = it.comment(c.stringOption("comment"));
        }
        return it;
    }

    /**
     * The aggregation options on the driver's {@link AggregateIterable}: maxTime (the card
     * timeout, or maxTimeMS when lower), allowDiskUse, batchSize, collation, hint, comment and let.
     */
    static <T> AggregateIterable<T> applyAggregate(AggregateIterable<T> aggregate, MongoCall c, long timeoutMs) {
        AggregateIterable<T> it = aggregate.maxTime(maxTime(c, timeoutMs), TimeUnit.MILLISECONDS);
        if (c.boolOption("allowDiskUse") != null) {
            it = it.allowDiskUse(c.boolOption("allowDiskUse"));
        }
        if (c.intOption("batchSize") != null) {
            it = it.batchSize(c.intOption("batchSize"));
        }
        if (c.collationOption() != null) {
            it = it.collation(c.collationOption());
        }
        BsonValue hint = c.hintOption();
        if (hint != null) {
            it = hint.isString() ? it.hintString(hint.asString().getValue()) : it.hint(hint.asDocument());
        }
        if (c.stringOption("comment") != null) {
            it = it.comment(c.stringOption("comment"));
        }
        if (c.documentOption("let") != null) {
            it = it.let(c.documentOption("let"));
        }
        return it;
    }

    /** deleteOne/deleteMany options: collation, hint, comment, let. */
    static DeleteOptions deleteOptions(MongoCall c) {
        DeleteOptions o = new DeleteOptions().collation(c.collationOption()).comment(c.stringOption("comment"))
                .let(c.documentOption("let"));
        BsonValue hint = c.hintOption();
        return hint == null ? o : hint.isString() ? o.hintString(hint.asString().getValue()) : o.hint(hint.asDocument());
    }

    /** updateOne/updateMany options: upsert, arrayFilters, collation, hint, comment, let. */
    static UpdateOptions updateOptions(MongoCall c) {
        UpdateOptions o = new UpdateOptions().collation(c.collationOption()).comment(c.stringOption("comment"))
                .let(c.documentOption("let")).arrayFilters(c.arrayFiltersOption());
        if (c.boolOption("upsert") != null) {
            o.upsert(c.boolOption("upsert"));
        }
        BsonValue hint = c.hintOption();
        return hint == null ? o : hint.isString() ? o.hintString(hint.asString().getValue()) : o.hint(hint.asDocument());
    }

    /** insertOne options: comment, bypassDocumentValidation. */
    static InsertOneOptions insertOneOptions(MongoCall c) {
        InsertOneOptions o = new InsertOneOptions().comment(c.stringOption("comment"));
        return c.boolOption("bypassDocumentValidation") == null ? o
                : o.bypassDocumentValidation(c.boolOption("bypassDocumentValidation"));
    }

    /** insertMany options: ordered, comment, bypassDocumentValidation. */
    static InsertManyOptions insertManyOptions(MongoCall c) {
        InsertManyOptions o = new InsertManyOptions().comment(c.stringOption("comment"));
        if (c.boolOption("ordered") != null) {
            o.ordered(c.boolOption("ordered"));
        }
        return c.boolOption("bypassDocumentValidation") == null ? o
                : o.bypassDocumentValidation(c.boolOption("bypassDocumentValidation"));
    }

    private static Document deleted(DeleteResult r) {
        return new Document("deletedCount", r.getDeletedCount());
    }

    private static Document updated(UpdateResult r) {
        return new Document("matchedCount", r.getMatchedCount())
                .append("modifiedCount", r.getModifiedCount())
                .append("upsertedId", r.getUpsertedId() == null ? null : id(r.getUpsertedId()));
    }

    private static List<BsonDocument> stages(MongoCall c) {
        return c.update().asArray().getValues().stream().map(BsonValue::asDocument).toList();
    }

    private static Document document(BsonDocument doc) {
        return Document.parse(doc.toJson());
    }

    /** An id as published: ObjectIds as hex strings, other values as their JSON value. */
    static Object id(BsonValue id) {
        if (id == null) {
            return null;
        }
        if (id.isObjectId()) {
            return id.asObjectId().getValue().toHexString();
        }
        return Document.parse(new BsonDocument("v", id).toJson()).get("v");
    }

    private static long maxTime(MongoCall c, long timeoutMs) {
        Integer maxTimeMS = c.intOption("maxTimeMS");
        return maxTimeMS == null || maxTimeMS == 0 ? timeoutMs : Math.min(timeoutMs, maxTimeMS); // 0 = no own limit
    }

    private MongoTemplate template(String uri) {
        ConnectionString connection = new ConnectionString(uri);
        if (connection.getDatabase() == null || connection.getDatabase().isBlank()) {
            throw new IllegalArgumentException("base-url must name a database, e.g. mongodb://localhost:27017/products");
        }
        SimpleMongoClientDatabaseFactory factory = factories.computeIfAbsent(uri, key -> new SimpleMongoClientDatabaseFactory(
                MongoClients.create(MongoClientSettings.builder()
                        .applyConnectionString(connection)
                        .applyToClusterSettings(b -> b.serverSelectionTimeout(3, TimeUnit.SECONDS))
                        .applyToSocketSettings(b -> b.connectTimeout(3, TimeUnit.SECONDS))
                        .build()),
                connection.getDatabase()));
        return new MongoTemplate(factory);
    }

    @PreDestroy
    void close() {
        for (SimpleMongoClientDatabaseFactory factory : factories.values()) {
            try {
                factory.destroy();
            } catch (Exception ignored) {
                // shutting down: nothing else to do
            }
        }
    }
}
