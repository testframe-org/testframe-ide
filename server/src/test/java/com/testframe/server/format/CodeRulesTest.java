package com.testframe.server.format;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class CodeRulesTest {

    @Test
    void mongoAcceptsOneReadShellCall() {
        assertNull(CodeRules.problem("mongo", "db.products.find({ ativo: true })"));
        assertNull(CodeRules.problem("mongo", "db.products.find({ ativo: true }).limit(5)"));
        assertNull(CodeRules.problem("mongo", "db.products.aggregate([{ $match: { ativo: true } }])"));
        assertNull(CodeRules.problem("mongo", "// comment\n db.x.distinct('campo')\n"));
        assertNull(CodeRules.problem("mongo", ""));
        assertNull(CodeRules.problem("mongo", null));
    }

    @Test
    void mongoRejectsWritesOtherShapesAndMultipleCalls() {
        assertEquals("mongo cards accept one mongo shell call, e.g. db.products.find({ ativo: true })",
                CodeRules.problem("mongo", "const p = await db.collection(\"products\").find().toArray();"));
        assertEquals("mongo operation \"deleteMany\" is not allowed (find, findOne, aggregate, countDocuments, distinct)",
                CodeRules.problem("mongo", "db.products.deleteMany({})"));
        assertEquals("unbalanced brackets or quotes",
                CodeRules.problem("mongo", "db.products.find({ ativo: true "));
        assertEquals("the mongo call must end with \")\"",
                CodeRules.problem("mongo", "db.products.find({ a: 1 }) [0]"));
        assertEquals("only one mongo call is allowed",
                CodeRules.problem("mongo", "db.a.find(); db.b.find()"));
    }

    @Test
    void oracleAcceptsOneSelectOnly() {
        assertNull(CodeRules.problem("oracle", "SELECT * FROM products WHERE ativo = 1"));
        assertNull(CodeRules.problem("oracle", "-- ok\nselect 1 from dual;"));
        assertNull(CodeRules.problem("oracle", ""));
        assertEquals("oracle cards accept a single SELECT statement",
                CodeRules.problem("oracle", "DELETE FROM products"));
        assertEquals("only one SELECT statement is allowed",
                CodeRules.problem("oracle", "SELECT 1 FROM dual; DROP TABLE products"));
        assertNull(CodeRules.problem("oracle", "SELECT ';' AS sep FROM dual"), "semicolons inside strings do not split");
    }

    @Test
    void assertAcceptsOnlyJsonassertLines() {
        assertNull(CodeRules.problem("assert", "assert $count(activeProducts) > 0\nassert status == \"PROCESSADO\""));
        assertNull(CodeRules.problem("assert", "// draft"));
        assertNull(CodeRules.problem("assert", ""));
        assertEquals("not a jsonassert line: expect(res.status).toBe(200);",
                CodeRules.problem("assert", "expect(res.status).toBe(200);"));
    }

    @Test
    void typesWithoutRulesAcceptAnything() {
        assertNull(CodeRules.problem("restapi", "{ \"a\": 1 }"));
        assertNull(CodeRules.problem("filter", "$[price > 10]"));
        assertNull(CodeRules.problem("inline", "not even close"));
        assertNull(CodeRules.problem(null, "x"));
    }
}
