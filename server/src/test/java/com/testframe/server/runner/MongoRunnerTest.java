package com.testframe.server.runner;

import com.mongodb.client.AggregateIterable;
import com.mongodb.client.FindIterable;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.Collation;
import com.mongodb.client.model.CollationStrength;
import com.mongodb.client.model.DeleteOptions;
import com.mongodb.client.model.InsertManyOptions;
import com.mongodb.client.model.InsertOneOptions;
import com.mongodb.client.model.UpdateOptions;
import com.mongodb.client.result.DeleteResult;
import com.mongodb.client.result.InsertManyResult;
import com.mongodb.client.result.InsertOneResult;
import com.mongodb.client.result.UpdateResult;
import com.testframe.server.format.MongoCall;
import org.bson.BsonDocument;
import org.bson.BsonInt32;
import org.bson.BsonObjectId;
import org.bson.BsonValue;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The call's arguments reach the driver (recorded through proxies: no database needed). */
class MongoRunnerTest {

    /** A FindIterable/AggregateIterable that records every call as "name(args)" and returns itself. */
    @SuppressWarnings("unchecked")
    private static <T> T recorder(Class<T> type, List<String> calls) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            calls.add(method.getName() + (args == null ? "()" : Arrays.toString(args)));
            return proxy;
        });
    }

    /** A collection that records write calls and answers them with {@code answers} by method name. */
    @SuppressWarnings("unchecked")
    private static MongoCollection<Document> collection(List<Object[]> calls, Map<String, Object> answers) {
        return (MongoCollection<Document>) Proxy.newProxyInstance(MongoCollection.class.getClassLoader(),
                new Class<?>[]{MongoCollection.class}, (proxy, method, args) -> {
                    Object[] call = new Object[(args == null ? 0 : args.length) + 1];
                    call[0] = method.getName();
                    if (args != null) {
                        System.arraycopy(args, 0, call, 1, args.length);
                    }
                    calls.add(call);
                    return answers.get(method.getName());
                });
    }

    @Test
    void findArgumentsMapToTheFindIterable() {
        MongoCall c = MongoCall.parse("find", "products", """
                [{"ativo": true}, {"nome": 1}, {"sort": {"preco": -1}, "limit": 5000, "skip": 2, "maxTimeMS": 300,
                  "collation": {"locale": "pt", "strength": 2}, "hint": "nome_1", "comment": "smoke"}]
                """);
        List<String> calls = new ArrayList<>();
        MongoRunner.applyFind(recorder(FindIterable.class, calls), c, 5000);
        assertEquals(List.of("limit[1000]", "maxTime[300, MILLISECONDS]", "projection[{\"nome\": 1}]", "sort[{\"preco\": -1}]",
                "skip[2]", "collation[" + Collation.builder().locale("pt").collationStrength(CollationStrength.SECONDARY).build() + "]",
                "hintString[nome_1]", "comment[smoke]"), calls, "limit is capped, maxTimeMS lowers the card timeout");

        List<String> bare = new ArrayList<>();
        MongoRunner.applyFind(recorder(FindIterable.class, bare), MongoCall.parse("find", "products", "[{}]"), 800);
        assertEquals(List.of("limit[1000]", "maxTime[800, MILLISECONDS]"), bare);
    }

    @Test
    void aggregationOptionsMapToTheAggregateIterable() {
        MongoCall c = MongoCall.parse("aggregation", "products", """
                [[{"$match": {"$expr": {"$eq": ["$ativo", "$$wanted"]}}}], {"allowDiskUse": true, "maxTimeMS": 0,
                 "batchSize": 50, "hint": {"categoria": 1}, "comment": "report", "let": {"wanted": true}}]
                """);
        List<String> calls = new ArrayList<>();
        MongoRunner.applyAggregate(recorder(AggregateIterable.class, calls), c, 5000);
        assertEquals(List.of("maxTime[5000, MILLISECONDS]", "allowDiskUse[true]", "batchSize[50]",
                "hint[{\"categoria\": 1}]", "comment[report]", "let[{\"wanted\": true}]"), calls,
                "maxTimeMS 0 keeps the card timeout");
    }

    @Test
    void writeOptionsMapToTheDriverOptions() {
        DeleteOptions d = MongoRunner.deleteOptions(MongoCall.parse("deleteMany", "c",
                "[{\"a\": 1}, {\"collation\": {\"locale\": \"pt\"}, \"hint\": \"a_1\", \"comment\": \"c\", \"let\": {\"x\": 1}}]"));
        assertEquals("pt", d.getCollation().getLocale());
        assertEquals("a_1", d.getHintString());
        assertEquals("c", d.getComment().asString().getValue());
        assertEquals(new BsonDocument("x", new BsonInt32(1)), d.getLet());

        UpdateOptions u = MongoRunner.updateOptions(MongoCall.parse("updateOne", "c",
                "[{\"a\": 1}, {\"$set\": {\"b.$[e]\": 1}}, {\"upsert\": true, \"arrayFilters\": [{\"e\": 0}], \"hint\": {\"a\": 1}}]"));
        assertTrue(u.isUpsert());
        assertEquals(1, u.getArrayFilters().size());
        assertEquals(new BsonDocument("a", new BsonInt32(1)), u.getHint());
        assertFalse(MongoRunner.updateOptions(MongoCall.parse("updateMany", "c", "[{\"a\": 1}, {\"$inc\": {\"n\": 1}}]")).isUpsert());

        InsertOneOptions one = MongoRunner.insertOneOptions(MongoCall.parse("insertOne", "c",
                "[{\"a\": 1}, {\"bypassDocumentValidation\": true, \"comment\": \"seed\"}]"));
        assertEquals(Boolean.TRUE, one.getBypassDocumentValidation());
        InsertManyOptions many = MongoRunner.insertManyOptions(MongoCall.parse("insertMany", "c",
                "[[{\"a\": 1}], {\"ordered\": false}]"));
        assertFalse(many.isOrdered());
        assertNull(many.getBypassDocumentValidation());
    }

    @Test
    void writesRunOnTheCollectionAndPublishTheirCounts() {
        List<Object[]> calls = new ArrayList<>();
        ObjectId id = new ObjectId("6b022609da8071eb915cbe8a");
        Map<String, Object> answers = Map.of(
                "deleteMany", DeleteResult.acknowledged(3),
                "updateOne", UpdateResult.acknowledged(0, 0L, new BsonObjectId(id)),
                "insertOne", InsertOneResult.acknowledged(new BsonObjectId(id)),
                "insertMany", InsertManyResult.acknowledged(Map.<Integer, BsonValue>of(0, new BsonObjectId(id), 1, new BsonInt32(7))));
        MongoCollection<Document> collection = collection(calls, answers);

        assertEquals(new Document("deletedCount", 3L),
                MongoRunner.execute(collection, MongoCall.parse("deleteMany", "c", "[{\"tmp\": true}]"), 1000));
        assertEquals("deleteMany", calls.getLast()[0]);
        assertEquals(BsonDocument.parse("{\"tmp\": true}"), calls.getLast()[1]);

        Document updated = (Document) MongoRunner.execute(collection,
                MongoCall.parse("updateOne", "c", "[{\"k\": \"a\"}, {\"$set\": {\"v\": 1}}, {\"upsert\": true}]"), 1000);
        assertEquals("6b022609da8071eb915cbe8a", updated.get("upsertedId"), "ObjectIds are published as hex strings");
        assertTrue(((UpdateOptions) calls.getLast()[3]).isUpsert());

        assertEquals(new Document("insertedId", "6b022609da8071eb915cbe8a"),
                MongoRunner.execute(collection, MongoCall.parse("insertOne", "c", "[{\"k\": \"a\"}]"), 1000));
        assertEquals(new Document("insertedIds", List.of("6b022609da8071eb915cbe8a", 7)).append("insertedCount", 2),
                MongoRunner.execute(collection, MongoCall.parse("insertMany", "c", "[[{\"k\": 1}, {\"_id\": 7}]]"), 1000));
        assertEquals(2, ((List<?>) calls.getLast()[1]).size());
    }
}
