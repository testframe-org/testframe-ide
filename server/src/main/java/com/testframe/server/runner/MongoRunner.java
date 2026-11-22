package com.testframe.server.runner;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.AggregateIterable;
import com.mongodb.client.FindIterable;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import jakarta.annotation.PreDestroy;
import com.testframe.server.format.MongoQuery;
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
 * Executes a mongo card body ({@link MongoQuery}, subtype find or aggregation) with Spring
 * Data's {@link MongoTemplate} against the database named in the source's base-url (e.g.
 * mongodb://localhost:27017/products). One template per base-url, created on first use.
 * Read-only: {@link MongoQuery} rejects write stages before anything connects.
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
    public String run(String uri, MongoQuery query, long timeoutMs) {
        MongoCollection<Document> collection = template(uri).getCollection(query.collection());
        List<Document> result = switch (query.subtype()) {
            case MongoQuery.FIND -> applyFind(collection.find(query.filter()), query, timeoutMs).into(new ArrayList<>());
            case MongoQuery.AGGREGATION -> {
                List<Document> docs = applyAggregate(collection.aggregate(query.pipeline()), query, timeoutMs)
                        .into(new ArrayList<>());
                yield docs.size() > MAX_DOCUMENTS ? docs.subList(0, MAX_DOCUMENTS) : docs;
            }
            default -> throw new IllegalArgumentException("unknown mongo subtype \"" + query.subtype() + "\"");
        };
        return new Document("operation", query.subtype())
                .append("collection", query.collection())
                .append("count", result.size())
                .append("result", result)
                .toJson(JSON);
    }

    /**
     * The find sections on the driver's {@link FindIterable}: projection, sort, skip, limit (at most
     * {@link #MAX_DOCUMENTS}), maxTime (the card timeout, or maxTimeMS when lower), collation, hint
     * (index name or keys) and comment.
     */
    static <T> FindIterable<T> applyFind(FindIterable<T> find, MongoQuery q, long timeoutMs) {
        FindIterable<T> it = find.projection(q.projection()).sort(q.sort())
                .limit(q.limit() == null ? MAX_DOCUMENTS : Math.min(MAX_DOCUMENTS, q.limit()))
                .maxTime(maxTime(q, timeoutMs), TimeUnit.MILLISECONDS);
        if (q.skip() != null) {
            it = it.skip(q.skip());
        }
        MongoQuery.Options o = q.options();
        if (o.collation() != null) {
            it = it.collation(o.collation());
        }
        if (o.hint() != null) {
            it = o.hint().isString() ? it.hintString(o.hint().asString().getValue()) : it.hint(o.hint().asDocument());
        }
        if (o.comment() != null) {
            it = it.comment(o.comment());
        }
        return it;
    }

    /**
     * The aggregation option sections on the driver's {@link AggregateIterable}: maxTime (the card
     * timeout, or maxTimeMS when lower), allowDiskUse, batchSize, collation, hint, comment and let.
     */
    static <T> AggregateIterable<T> applyAggregate(AggregateIterable<T> aggregate, MongoQuery q, long timeoutMs) {
        AggregateIterable<T> it = aggregate.maxTime(maxTime(q, timeoutMs), TimeUnit.MILLISECONDS);
        MongoQuery.Options o = q.options();
        if (o.allowDiskUse() != null) {
            it = it.allowDiskUse(o.allowDiskUse());
        }
        if (o.batchSize() != null) {
            it = it.batchSize(o.batchSize());
        }
        if (o.collation() != null) {
            it = it.collation(o.collation());
        }
        if (o.hint() != null) {
            it = o.hint().isString() ? it.hintString(o.hint().asString().getValue()) : it.hint(o.hint().asDocument());
        }
        if (o.comment() != null) {
            it = it.comment(o.comment());
        }
        if (o.let() != null) {
            it = it.let(o.let());
        }
        return it;
    }

    private static long maxTime(MongoQuery q, long timeoutMs) {
        Integer maxTimeMS = q.options().maxTimeMS();
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
