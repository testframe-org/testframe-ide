package com.testframe.server.format;

import com.testframe.server.dto.Card;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MongoSectionsTest {

    /** The find card exactly as the user pasted it (blank lines around and inside the blocks). */
    private static final String USER_FIND = """
            -------------------
            title: Get active products
            source: mongo/products-db
            subtype: find
            collection: products
            timeout: 5000
            -------------------
            filter
            ```json

            { "ativo": true }

            ```

            projection
            ```json
            { "ativo": 1 }
            ```
            """;

    private static final String USER_AGGREGATION = """
            -------------------
            title: Count by category
            source: mongo/products-db
            subtype: aggregation
            collection: products
            timeout: 5000
            -------------------
            aggregation
            ```json
            [
              { "$match": { "ativo": true } },

              { "$group": { "_id": "$categoria", "total": { "$sum": 1 } } }
            ]
            ```
            """;

    @Test
    void parsesTheUsersFindPasteAndRendersItCanonically() {
        CardCodec.Parsed parsed = CardCodec.parse("get-active-products", USER_FIND);
        assertEquals(List.of(), parsed.errors());
        Card card = parsed.card();
        assertEquals("{\n  \"filter\": { \"ativo\": true },\n  \"projection\": { \"ativo\": 1 }\n}", card.code(),
                "on the wire the sections are one JSON object");
        String canonical = """
                -------------------
                title: Get active products
                source: mongo/products-db
                subtype: find
                collection: products
                timeout: 5000
                -------------------
                filter
                ```json
                { "ativo": true }
                ```
                projection
                ```json
                { "ativo": 1 }
                ```
                """;
        assertEquals(canonical, CardCodec.render(card));
        assertEquals(canonical, CardCodec.render(CardCodec.parse("get-active-products", canonical).card()), "stable");
    }

    @Test
    void parsesTheAggregationSection() {
        CardCodec.Parsed parsed = CardCodec.parse("count-by-category", USER_AGGREGATION);
        assertEquals(List.of(), parsed.errors());
        String code = parsed.card().code();
        assertNull(MongoQuery.problem("aggregation", code));
        assertEquals(2, MongoQuery.parse("aggregation", "products", code).pipeline().size());
        assertEquals("""
                aggregation
                ```json
                [
                  { "$match": { "ativo": true } },
                  { "$group": { "_id": "$categoria", "total": { "$sum": 1 } } }
                ]
                ```""", MongoSections.render("aggregation", code), "blank lines inside the block are dropped");
    }

    @Test
    void sectionsFollowTheFixedOrderAndKeepBindings() {
        String code = "{ \"limit\": {{n}}, \"sort\": { \"preco\": -1 }, \"filter\": { \"nome\": \"{{first.nome}}\" } }";
        assertEquals("""
                filter
                ```json
                { "nome": "{{first.nome}}" }
                ```
                sort
                ```json
                { "preco": -1 }
                ```
                limit
                ```json
                {{n}}
                ```""", MongoSections.render("find", code));
        assertEquals("", MongoSections.render("find", ""));
        assertEquals("", MongoSections.parse("find", "\n\n"), "no sections: an empty find reads everything");
        assertNull(MongoSections.render("find", "not json"), "a draft stays one fenced block");
        assertEquals(Map.of("a", "1", "b", "[1, {\"c\": \"x,y\"}]"), MongoSections.split("{ \"a\": 1, \"b\": [1, {\"c\": \"x,y\"}] }"));
    }

    @Test
    void optionSectionsComeAfterTheMainOnesInCanonicalOrder() {
        String code = "{ \"let\": { \"x\": 1 }, \"comment\": \"r\", \"aggregation\": [{ \"$match\": {} }], \"allowDiskUse\": true }";
        assertEquals("""
                aggregation
                ```json
                [{ "$match": {} }]
                ```
                allowDiskUse
                ```json
                true
                ```
                comment
                ```json
                "r"
                ```
                let
                ```json
                { "x": 1 }
                ```""", MongoSections.render("aggregation", code));
        String parsed = MongoSections.parse("aggregation", MongoSections.render("aggregation", code));
        assertNull(MongoQuery.problem("aggregation", parsed));
        assertEquals(MongoSections.render("aggregation", code), MongoSections.render("aggregation", parsed));
    }

    @Test
    void invalidSectionsAreReported() {
        assertEquals("unknown section \"pipeline\" (find accepts filter, projection, sort, limit, skip, maxTimeMS, collation, hint, comment)",
                assertThrows(IllegalArgumentException.class, () -> MongoSections.parse("find", "pipeline\n```json\n[]\n```")).getMessage());
        assertEquals("unknown section \"filter\" (aggregation accepts aggregation, allowDiskUse, maxTimeMS, batchSize, collation, hint, comment, let)",
                assertThrows(IllegalArgumentException.class, () -> MongoSections.parse("aggregation", "filter\n```json\n{}\n```")).getMessage());
        assertEquals("section \"filter\" is written twice",
                assertThrows(IllegalArgumentException.class,
                        () -> MongoSections.parse("find", "filter\n```json\n{}\n```\nfilter\n```json\n{}\n```")).getMessage());
        assertEquals("section \"filter\" needs a ```json block after its label",
                assertThrows(IllegalArgumentException.class, () -> MongoSections.parse("find", "filter\n{ \"a\": 1 }")).getMessage());
        assertEquals("a ```json block without a section label before it",
                assertThrows(IllegalArgumentException.class, () -> MongoSections.parse("find", "```json\n{}\n```")).getMessage());
        assertEquals("section \"filter\": the ```json block is not closed",
                assertThrows(IllegalArgumentException.class, () -> MongoSections.parse("find", "filter\n```json\n{}")).getMessage());
        assertEquals("unknown section \"some text\" (find accepts filter, projection, sort, limit, skip, maxTimeMS, collation, hint, comment)",
                assertThrows(IllegalArgumentException.class, () -> MongoSections.parse("find", "some text")).getMessage(),
                "text outside sections");

        CardCodec.Parsed bad = CardCodec.parse("q", "-------------------\ntitle: Q\nsource: mongo/db\nsubtype: find\n"
                + "collection: x\n-------------------\nfilter\n```json\n{}\n```\nlimit\n");
        assertEquals(List.of("body: section \"limit\" needs a ```json block after its label"), bad.errors());
    }

    @Test
    void aggregationValuesAreCheckedByTheCodeRule() {
        assertEquals("aggregation must be an array of stages (the pipeline)",
                MongoQuery.problem("aggregation", MongoSections.parse("aggregation", "aggregation\n```json\n{}\n```")));
        assertEquals("an aggregation needs at least one stage",
                MongoQuery.problem("aggregation", MongoSections.parse("aggregation", "aggregation\n```json\n[]\n```")));
        assertEquals("write stage \"$out\" is not allowed (mongo cards are read-only)",
                MongoQuery.problem("aggregation", MongoSections.parse("aggregation", "aggregation\n```json\n[{ \"$out\": \"x\" }]\n```")));
    }
}
