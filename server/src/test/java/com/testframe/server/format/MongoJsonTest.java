package com.testframe.server.format;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class MongoJsonTest {

    @Test
    void formatsTheUsersPasteCanonically() {
        // trailing spaces, irregular indentation, blank lines: the user may type it any way
        String paste = "[   \n      {\"ativo\" :true ,  \"categoria\":   \"Ferramentas\"}   ,\n\n"
                + "  { \"nome\": 1,\n        \"preco\":1 }  ,   {\"sort\":{\"preco\":-1},\"limit\":  5}\n   ]   \n";
        String canonical = """
                [
                  { "ativo": true, "categoria": "Ferramentas" },
                  { "nome": 1, "preco": 1 },
                  { "sort": { "preco": -1 }, "limit": 5 }
                ]""";
        assertEquals(canonical, MongoJson.format(paste));
        assertEquals(canonical, MongoJson.format(canonical), "idempotent");
    }

    @Test
    void keepsBindingsStringsAndNumbersVerbatim() {
        assertEquals("""
                [
                  { "nome": "{{first.nome}}", "preco": {{max}}, "s": "a,b: {c}", "n": 1.50e2 },
                  [{ "$match": {} }, { "$limit": {{n}} }]
                ]""", MongoJson.format("[{\"nome\":\"{{first.nome}}\",\"preco\":{{max}},\"s\":\"a,b: {c}\",\"n\":1.50e2},"
                + "[{\"$match\":{}},{\"$limit\":{{n}}}]]"));
        assertEquals("[]", MongoJson.format(" [ ] "));
        assertEquals("", MongoJson.format("  "));
    }

    @Test
    void malformedOrNonArrayBodiesDoNotFormat() {
        assertNull(MongoJson.format("{ \"filter\": {} }"), "the body is an array");
        assertNull(MongoJson.format("[{ \"a\": 1 }"));
        assertNull(MongoJson.format("[{ \"a\" 1 }]"));
        assertNull(MongoJson.format("[1] extra"));
    }
}
