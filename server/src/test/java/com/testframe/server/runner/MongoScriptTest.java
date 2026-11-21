package com.testframe.server.runner;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MongoScriptTest {

    @Test
    void parsesFindWithRelaxedJsonAndChain() {
        MongoScript s = MongoScript.parse("""
                // active products, cheapest first
                db.products.find({ ativo: true, nome: "a(b)" }, { nome: 1 }).sort({ preco: 1 }).limit(5);
                """);
        assertEquals("products", s.collection());
        assertEquals("find", s.operation());
        assertEquals(2, s.args().size());
        assertTrue(s.args().getFirst().asDocument().getBoolean("ativo").getValue());
        assertEquals("a(b)", s.args().getFirst().asDocument().getString("nome").getValue());
        assertEquals(2, s.chain().size());
        assertEquals("limit", s.chain().get(1).name());
        assertEquals(5, s.chain().get(1).args().getFirst().asNumber().intValue());
    }

    @Test
    void parsesAggregatePipelineAndEmptyArgs() {
        MongoScript agg = MongoScript.parse("db.orders.aggregate([{ $match: { status: 'paid' } }, { $count: 'n' }])");
        assertEquals(2, agg.args().getFirst().asArray().size());
        assertTrue(MongoScript.parse("db.products.find()").args().isEmpty());
    }

    @Test
    void rejectsMalformedScripts() {
        assertThrows(IllegalArgumentException.class, () -> MongoScript.parse("products.find({})"));
        assertThrows(IllegalArgumentException.class, () -> MongoScript.parse("db.products.find({ a: 1 }"));
        assertThrows(IllegalArgumentException.class, () -> MongoScript.parse("db.products.find({}) extra"));
        assertThrows(IllegalArgumentException.class, () -> MongoScript.parse("db.products.find({ a: })"));
    }
}
