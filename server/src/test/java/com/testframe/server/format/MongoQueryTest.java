package com.testframe.server.format;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MongoQueryTest {

    @Test
    void parsesAFindBodyWithTheCardsCollection() {
        MongoQuery q = MongoQuery.parse("find", "products", """
                {"filter": {"ativo": true, "_id": {"$oid": "6b022609da8071eb915cbe8a"}},
                 "projection": {"nome": 1}, "sort": {"preco": -1}, "limit": 5, "skip": 2}
                """);
        assertEquals("find", q.subtype());
        assertEquals("products", q.collection(), "the collection comes from the card's frontmatter");
        assertTrue(q.filter().getBoolean("ativo").getValue());
        assertTrue(q.filter().get("_id").isObjectId(), "extended JSON is understood");
        assertEquals(1, q.projection().getInt32("nome").getValue());
        assertEquals(-1, q.sort().getInt32("preco").getValue());
        assertEquals(5, q.limit());
        assertEquals(2, q.skip());
        assertEquals(List.of(), q.pipeline());

        MongoQuery bare = MongoQuery.parse("find", "products", "{}");
        assertTrue(bare.filter().isEmpty());
        assertNull(bare.limit());
        assertTrue(MongoQuery.parse("find", "products", "  ").filter().isEmpty(), "a blank find body reads everything");
    }

    @Test
    void parsesAnAggregationBody() {
        MongoQuery q = MongoQuery.parse("aggregation", "orders", """
                {"aggregation": [{"$match": {"status": "paid"}}, {"$count": "n"}]}
                """);
        assertEquals("aggregation", q.subtype());
        assertEquals("orders", q.collection());
        assertEquals(2, q.pipeline().size());
        assertEquals("n", q.pipeline().get(1).getString("$count").getValue());
    }

    @Test
    void theCollectionIsAPlainName() {
        assertNull(MongoQuery.collectionProblem("products"));
        assertNull(MongoQuery.collectionProblem("order.items"));
        assertEquals("required on mongo cards (the collection the query reads)", MongoQuery.collectionProblem(null));
        assertEquals("required on mongo cards (the collection the query reads)", MongoQuery.collectionProblem(" "));
        assertEquals("\"a$b\" is not a collection name (no $, no spaces around, no null character)",
                MongoQuery.collectionProblem("a$b"));
        assertTrue(MongoQuery.collectionProblem("a\0b").startsWith("\"a"));
        assertEquals("system collections cannot be queried", MongoQuery.collectionProblem("system.users"));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse("find", "", "{}"));
        assertEquals("collection: required on mongo cards (the collection the query reads)", e.getMessage());
    }

    @Test
    void rejectsWriteStagesAnywhereInThePipeline() {
        IllegalArgumentException out = assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse("aggregation", "x",
                "{\"aggregation\": [{\"$match\": {}}, {\"$out\": \"copy\"}]}"));
        assertEquals("write stage \"$out\" is not allowed (mongo cards are read-only)", out.getMessage());
        IllegalArgumentException merge = assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse("aggregation", "x",
                "{\"aggregation\": [{\"$facet\": {\"a\": [{\"$merge\": \"y\"}]}}]}"));
        assertEquals("write stage \"$merge\" is not allowed (mongo cards are read-only)", merge.getMessage());
    }

    @Test
    void rejectsUnknownKeysAndWrongShapes() {
        assertEquals("unknown key \"collection\" (find accepts filter, projection, sort, limit, skip, maxTimeMS, collation, hint, comment)",
                MongoQuery.problem("find", "{\"collection\": \"x\"}"), "the collection lives in the frontmatter");
        assertEquals("unknown key \"update\" (find accepts filter, projection, sort, limit, skip, maxTimeMS, collation, hint, comment)",
                MongoQuery.problem("find", "{\"update\": {}}"));
        assertEquals("unknown key \"filter\" (aggregation accepts aggregation, allowDiskUse, maxTimeMS, batchSize, collation, hint, comment, let)",
                MongoQuery.problem("aggregation", "{\"filter\": {}, \"aggregation\": []}"));
        assertEquals("aggregation is required, e.g. mongo aggregation bodies are one JSON object: {\"aggregation\": [{\"$match\": {\"ativo\": true}}]}",
                MongoQuery.problem("aggregation", "{}"));
        assertEquals("filter must be an object", MongoQuery.problem("find", "{\"filter\": [1]}"));
        assertEquals("limit must be a non-negative integer", MongoQuery.problem("find", "{\"limit\": -1}"));
        assertEquals("limit must be a non-negative integer", MongoQuery.problem("find", "{\"limit\": 1.5}"));
        assertEquals("aggregation must be an array of stages (the pipeline)", MongoQuery.problem("aggregation", "{\"aggregation\": {}}"));
        assertEquals("aggregation stage 1 must be an object", MongoQuery.problem("aggregation", "{\"aggregation\": [1]}"));
        assertEquals("unknown mongo subtype \"remove\" (find, aggregation)", MongoQuery.problem("remove", "{}"));
        assertTrue(MongoQuery.problem("find", "db.products.find({ ativo: true })").startsWith("invalid JSON: "),
                "the shell syntax is gone: bodies are JSON");
        assertTrue(MongoQuery.problem("find", "{filter: {}}").startsWith("invalid JSON: "), "strict JSON");
        assertTrue(MongoQuery.problem("find", "[1]").startsWith("mongo find bodies are one JSON object"));
        assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse(null, "x", "{}"),
                "running needs the card's subtype");
    }

    @Test
    void optionSectionsAreTypeChecked() {
        assertNull(MongoQuery.problem("find", "{\"maxTimeMS\": 100, \"collation\": {\"locale\": \"pt\"}, \"hint\": {\"nome\": 1}, \"comment\": \"c\"}"));
        assertNull(MongoQuery.problem("aggregation", "{\"aggregation\": [{\"$match\": {}}], \"allowDiskUse\": false, "
                + "\"batchSize\": 10, \"hint\": \"idx\", \"let\": {\"x\": 1}}"));
        assertEquals("allowDiskUse must be true or false",
                MongoQuery.problem("aggregation", "{\"aggregation\": [{}], \"allowDiskUse\": \"yes\"}"));
        assertEquals("batchSize must be a positive integer",
                MongoQuery.problem("aggregation", "{\"aggregation\": [{}], \"batchSize\": 0}"));
        assertEquals("maxTimeMS must be a non-negative integer", MongoQuery.problem("find", "{\"maxTimeMS\": -1}"));
        assertEquals("hint must be an index name (string) or an index key object", MongoQuery.problem("find", "{\"hint\": 1}"));
        assertEquals("comment must be a string", MongoQuery.problem("find", "{\"comment\": {}}"));
        assertEquals("let must be an object", MongoQuery.problem("aggregation", "{\"aggregation\": [{}], \"let\": []}"));
        assertEquals("collation needs a locale, e.g. {\"locale\": \"pt\"}", MongoQuery.problem("find", "{\"collation\": {}}"));
        assertEquals("unknown collation key \"lang\" (locale, caseLevel, caseFirst, strength, numericOrdering, alternate, "
                + "maxVariable, normalization, backwards)", MongoQuery.problem("find", "{\"collation\": {\"locale\": \"pt\", \"lang\": 1}}"));
        assertEquals("unknown key \"allowDiskUse\" (find accepts filter, projection, sort, limit, skip, maxTimeMS, collation, hint, comment)",
                MongoQuery.problem("find", "{\"allowDiskUse\": true}"), "find has no allowDiskUse");
    }

    @Test
    void bindingsStandForAnyValueInTheCodeRule() {
        assertNull(MongoQuery.problem("find", "{\"filter\": {\"nome\": \"{{first.nome}}\"}, \"limit\": {{n}}}"));
        assertNull(MongoQuery.problem("find", "{\"filter\": \"{{filter}}\"}"));
        assertNull(MongoQuery.problem("aggregation", "{\"aggregation\": [{\"$match\": {\"a\": {{a}}}}, \"{{stage}}\"]}"));
        // once resolved, the real types are checked again
        assertThrows(IllegalArgumentException.class, () -> MongoQuery.parse("find", "x", "{\"limit\": \"{{n}}\"}"));
    }
}
