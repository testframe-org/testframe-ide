package com.testframe.server.runner;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClients;
import jakarta.annotation.PreDestroy;
import com.testframe.server.format.MongoQuery;
import org.bson.BsonDocument;
import org.bson.Document;
import org.bson.json.JsonMode;
import org.bson.json.JsonWriterSettings;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.SimpleMongoClientDatabaseFactory;
import org.springframework.data.mongodb.core.query.BasicQuery;
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
        MongoTemplate template = template(uri);
        List<Document> result = switch (query.subtype()) {
            case MongoQuery.FIND -> template.find(find(query, timeoutMs), Document.class, query.collection());
            case MongoQuery.AGGREGATION -> aggregate(template, query, timeoutMs);
            default -> throw new IllegalArgumentException("unknown mongo subtype \"" + query.subtype() + "\"");
        };
        return new Document("operation", query.subtype())
                .append("collection", query.collection())
                .append("count", result.size())
                .append("result", result)
                .toJson(JSON);
    }

    private static BasicQuery find(MongoQuery q, long timeoutMs) {
        BasicQuery query = new BasicQuery(doc(q.filter()), doc(q.projection()));
        query.setSortObject(doc(q.sort()));
        if (q.skip() != null) {
            query.skip(q.skip());
        }
        query.limit(q.limit() == null ? MAX_DOCUMENTS : Math.min(MAX_DOCUMENTS, q.limit()));
        query.maxTimeMsec(timeoutMs);
        return query;
    }

    private static List<Document> aggregate(MongoTemplate template, MongoQuery q, long timeoutMs) {
        List<Document> docs = template.getCollection(q.collection()).aggregate(q.pipeline())
                .maxTime(timeoutMs, TimeUnit.MILLISECONDS)
                .into(new ArrayList<>());
        return docs.size() > MAX_DOCUMENTS ? docs.subList(0, MAX_DOCUMENTS) : docs;
    }

    private static Document doc(BsonDocument value) {
        return value == null ? new Document() : Document.parse(value.toJson());
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
