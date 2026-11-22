package com.testframe.server.format;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MongoQueryTest {

    @Test
    void parsesAFindBody() {
        MongoQuery q = MongoQuery.parse("find", """
                {"collection": "products", "filter": {"ativo": true, "_id": {"$oid": "6b022609da8071eb915cbe8a"}},
                 "projection": {"nome": 1}, "sort": {"preco": -1}, "limit": 5, "skip": 2}
                """);
        assertEquals("find", q.subtype());
        assertEquals("products", q.collection());
        assertTrue(q.filter().getBoolean("ativo").getValue());
        assertTrue(q.filter().get("_id").isObjectId(), "extended JSON is understood");
        assertEquals(1, q.projection().getInt32("nome").getValue());
        assertEquals(-1, q.sort().getInt32("preco").getValue());
        assertEquals(5, q.limit());
        assertEquals(2, q.skip());
        assertEquals(List.of(), q.pipeline());

        MongoQuery bare = MongoQuery.parse("find", "{\"collection\": \"products\"}");
        assertTrue(bare.filter().isEmpty());
        assertNull(bare.limit());
    }

    @Test
    void parsesAnAggregationBody() {
        MongoQuery q = MongoQuery.parse("aggregation", """
                {"collection": "orders", "pipeline": [{"$match": {"status": "paid"}}, {"$count": "n"}]}
                """);
        assertEquals("aggregation", q.subtype());
        assertEquals("orders", q.collection());
        assertEquals(2, q.pipeline().size());
        assertEquals("n", q.pipeline().get(1).getString("$count").getValue());
    }

    @Test
    void rejectsWriteStagesAnywhereInThePipeline() {
        IllegalArgumentException out = assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse("aggregation",
                "{\"collection\": \"x\", \"pipeline\": [{\"$match\": {}}, {\"$out\": \"copy\"}]}"));
        assertEquals("write stage \"$out\" is not allowed (mongo cards are read-only)", out.getMessage());
        IllegalArgumentException merge = assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse("aggregation",
                "{\"collection\": \"x\", \"pipeline\": [{\"$facet\": {\"a\": [{\"$merge\": \"y\"}]}}]}"));
        assertEquals("write stage \"$merge\" is not allowed (mongo cards are read-only)", merge.getMessage());
    }

    @Test
    void rejectsUnknownKeysAndWrongShapes() {
        assertEquals("unknown key \"update\" (find accepts collection, filter, projection, sort, limit, skip)",
                MongoQuery.problem("find", "{\"collection\": \"x\", \"update\": {}}"));
        assertEquals("unknown key \"filter\" (aggregation accepts collection, pipeline)",
                MongoQuery.problem("aggregation", "{\"collection\": \"x\", \"filter\": {}, \"pipeline\": []}"));
        assertEquals("collection is required, e.g. mongo find bodies are one JSON object: {\"collection\": \"products\", \"filter\": {\"ativo\": true}}",
                MongoQuery.problem("find", "{\"filter\": {}}"));
        assertEquals("filter must be an object", MongoQuery.problem("find", "{\"collection\": \"x\", \"filter\": [1]}"));
        assertEquals("limit must be a non-negative integer", MongoQuery.problem("find", "{\"collection\": \"x\", \"limit\": -1}"));
        assertEquals("limit must be a non-negative integer", MongoQuery.problem("find", "{\"collection\": \"x\", \"limit\": 1.5}"));
        assertEquals("pipeline must be an array of stages",
                MongoQuery.problem("aggregation", "{\"collection\": \"x\", \"pipeline\": {}}"));
        assertEquals("pipeline stage 1 must be an object",
                MongoQuery.problem("aggregation", "{\"collection\": \"x\", \"pipeline\": [1]}"));
        assertEquals("unknown mongo subtype \"remove\" (find, aggregation)",
                MongoQuery.problem("remove", "{\"collection\": \"x\"}"));
        assertTrue(MongoQuery.problem("find", "db.products.find({ ativo: true })").startsWith("invalid JSON: "),
                "the shell syntax is gone: bodies are JSON");
        assertTrue(MongoQuery.problem("find", "{collection: \"x\"}").startsWith("invalid JSON: "), "strict JSON");
        assertTrue(MongoQuery.problem("find", "[1]").startsWith("mongo find bodies are one JSON object"));
        assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse(null, "{\"collection\": \"x\"}"),
                "running needs the card's subtype");
    }

    @Test
    void bindingsStandForAnyValueInTheCodeRule() {
        assertNull(MongoQuery.problem("find", "{\"collection\": \"products\", \"filter\": {\"nome\": \"{{first.nome}}\"}, \"limit\": {{n}}}"));
        assertNull(MongoQuery.problem("find", "{\"collection\": \"products\", \"filter\": \"{{filter}}\"}"));
        assertNull(MongoQuery.problem("aggregation", "{\"collection\": \"x\", \"pipeline\": [{\"$match\": {\"a\": {{a}}}}, \"{{stage}}\"]}"));
        // once resolved, the real types are checked again
        assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse("find", "{\"collection\": \"x\", \"limit\": \"{{n}}\"}"));
    }
}
