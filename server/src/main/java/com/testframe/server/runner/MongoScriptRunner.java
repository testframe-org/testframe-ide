package com.testframe.server.runner;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClients;
import jakarta.annotation.PreDestroy;
import org.bson.BsonDocument;
import org.bson.BsonValue;
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
 * Executes a mongo source script ({@link MongoScript}) with Spring Data's {@link MongoTemplate}
 * against the database named in the source's base-url (e.g. mongodb://localhost:27017/products).
 * One template per base-url, created on first use. Read-only operations only.
 */
@Service
public class MongoScriptRunner {

    public static final int MAX_DOCUMENTS = 1000;

    private static final JsonWriterSettings JSON = JsonWriterSettings.builder()
            .outputMode(JsonMode.RELAXED)
            .objectIdConverter((id, writer) -> writer.writeString(id.toHexString()))
            .build();

    private final Map<String, SimpleMongoClientDatabaseFactory> factories = new ConcurrentHashMap<>();

    /** Result as a JSON string: {"operation", "collection", "count", "result"}. */
    public String run(String uri, String script, long timeoutMs) {
        MongoScript parsed = MongoScript.parse(script);
        MongoTemplate template = template(uri);
        String collection = parsed.collection();

        Object result = switch (parsed.operation()) {
            case "find" -> template.find(query(parsed, timeoutMs, MAX_DOCUMENTS), Document.class, collection);
            case "findOne" -> template.findOne(query(parsed, timeoutMs, 1), Document.class, collection);
            case "aggregate" -> aggregate(template, parsed, timeoutMs);
            case "countDocuments" -> template.count(new BasicQuery(doc(parsed.args(), 0)), collection);
            case "distinct" -> distinct(template, parsed);
            default -> throw new IllegalArgumentException("Unsupported operation '" + parsed.operation()
                    + "' (read-only: find, findOne, aggregate, countDocuments, distinct)");
        };

        int count = result instanceof List<?> list ? list.size() : result == null ? 0 : 1;
        return new Document("operation", parsed.operation())
                .append("collection", collection)
                .append("count", count)
                .append("result", result)
                .toJson(JSON);
    }

    private static BasicQuery query(MongoScript s, long timeoutMs, int maxLimit) {
        BasicQuery query = new BasicQuery(doc(s.args(), 0), doc(s.args(), 1));
        int limit = maxLimit;
        for (MongoScript.Call call : s.chain()) {
            switch (call.name()) {
                case "sort" -> query.setSortObject(doc(call.args(), 0));
                case "skip" -> query.skip(intArg(call));
                case "limit" -> limit = Math.min(limit, intArg(call));
                default -> throw new IllegalArgumentException("Unsupported cursor method '" + call.name() + "' (sort, skip, limit)");
            }
        }
        query.limit(limit);
        query.maxTimeMsec(timeoutMs);
        return query;
    }

    private static List<Document> aggregate(MongoTemplate template, MongoScript s, long timeoutMs) {
        if (s.args().isEmpty() || !s.args().getFirst().isArray()) {
            throw new IllegalArgumentException("aggregate expects a pipeline array: db.c.aggregate([{ $match: {...} }])");
        }
        List<BsonDocument> pipeline = s.args().getFirst().asArray().getValues().stream().map(BsonValue::asDocument).toList();
        List<Document> docs = template.getCollection(s.collection()).aggregate(pipeline)
                .maxTime(timeoutMs, TimeUnit.MILLISECONDS)
                .into(new ArrayList<>());
        return docs.size() > MAX_DOCUMENTS ? docs.subList(0, MAX_DOCUMENTS) : docs;
    }

    private static List<Object> distinct(MongoTemplate template, MongoScript s) {
        if (s.args().isEmpty() || !s.args().getFirst().isString()) {
            throw new IllegalArgumentException("distinct expects a field name: db.c.distinct(\"field\", {...})");
        }
        return template.findDistinct(new BasicQuery(doc(s.args(), 1)), s.args().getFirst().asString().getValue(),
                s.collection(), Object.class);
    }

    private static Document doc(List<BsonValue> args, int index) {
        if (args.size() <= index) {
            return new Document();
        }
        BsonValue value = args.get(index);
        if (!value.isDocument()) {
            throw new IllegalArgumentException("Argument " + (index + 1) + " must be an object");
        }
        return Document.parse(value.asDocument().toJson());
    }

    private static int intArg(MongoScript.Call call) {
        if (call.args().isEmpty() || !call.args().getFirst().isNumber()) {
            throw new IllegalArgumentException(call.name() + " expects a number");
        }
        return call.args().getFirst().asNumber().intValue();
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
