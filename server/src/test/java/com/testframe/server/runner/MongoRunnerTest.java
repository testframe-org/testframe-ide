package com.testframe.server.runner;

import com.mongodb.client.AggregateIterable;
import com.mongodb.client.FindIterable;
import com.mongodb.client.model.Collation;
import com.mongodb.client.model.CollationStrength;
import com.testframe.server.format.MongoQuery;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The sections reach the driver's iterables (recorded through a proxy: no database needed). */
class MongoRunnerTest {

    /** A FindIterable/AggregateIterable that records every call as "name(args)" and returns itself. */
    @SuppressWarnings("unchecked")
    private static <T> T recorder(Class<T> type, List<String> calls) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            calls.add(method.getName() + (args == null ? "()" : Arrays.toString(args)));
            return proxy;
        });
    }

    @Test
    void findSectionsMapToTheFindIterable() {
        MongoQuery q = MongoQuery.parse("find", "products", """
                {"filter": {"ativo": true}, "projection": {"nome": 1}, "sort": {"preco": -1}, "limit": 5000,
                 "skip": 2, "maxTimeMS": 300, "collation": {"locale": "pt", "strength": 2},
                 "hint": "nome_1", "comment": "smoke"}
                """);
        List<String> calls = new ArrayList<>();
        MongoRunner.applyFind(recorder(FindIterable.class, calls), q, 5000);
        assertEquals(List.of(
                "projection[{\"nome\": 1}]", "sort[{\"preco\": -1}]", "limit[1000]", "maxTime[300, MILLISECONDS]", "skip[2]",
                "collation[" + Collation.builder().locale("pt").collationStrength(CollationStrength.SECONDARY).build() + "]",
                "hintString[nome_1]", "comment[smoke]"), calls, "limit is capped, maxTimeMS lowers the card timeout");

        List<String> bare = new ArrayList<>();
        MongoRunner.applyFind(recorder(FindIterable.class, bare), MongoQuery.parse("find", "products", ""), 800);
        assertEquals(List.of("projection[{}]", "sort[{}]", "limit[1000]", "maxTime[800, MILLISECONDS]"), bare);
    }

    @Test
    void aggregationOptionsMapToTheAggregateIterable() {
        MongoQuery q = MongoQuery.parse("aggregation", "products", """
                {"aggregation": [{"$match": {"ativo": "$$wanted"}}], "allowDiskUse": true, "maxTimeMS": 0,
                 "batchSize": 50, "hint": {"categoria": 1}, "comment": "report", "let": {"wanted": true}}
                """);
        assertEquals(1, q.pipeline().size());
        List<String> calls = new ArrayList<>();
        MongoRunner.applyAggregate(recorder(AggregateIterable.class, calls), q, 5000);
        assertEquals(List.of("maxTime[5000, MILLISECONDS]", "allowDiskUse[true]", "batchSize[50]",
                "hint[{\"categoria\": 1}]", "comment[report]", "let[{\"wanted\": true}]"), calls,
                "maxTimeMS 0 keeps the card timeout");
    }
}
