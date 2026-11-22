package com.testframe.server.format;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CodeRulesTest {

    @Test
    void mongoBodiesFollowTheCardSubtype() {
        String find = "[{\"ativo\": true}, null, {\"limit\": 5}]";
        String aggregation = "[[{\"$match\": {\"ativo\": true}}]]";
        assertNull(CodeRules.problem("mongo", "find", "[{\"ativo\": true}, {}, {\"limit\": 5}]"));
        assertNull(CodeRules.problem("mongo", "aggregation", aggregation));
        assertNull(CodeRules.problem("mongo", "find", ""));
        assertNull(CodeRules.problem("mongo", "aggregation", null));
        assertEquals("arg 1 (filter): must be an object", CodeRules.problem("mongo", "find", aggregation));
        assertEquals("arg 1 (pipeline): must be an array of stages", CodeRules.problem("mongo", "aggregation", "[{\"ativo\": true}]"));
        assertTrue(CodeRules.problem("mongo", "aggregation", find).startsWith("aggregation takes at most 2 arguments"));
        assertEquals(List.of("arg 2 (projection): must be an object", "arg 3 (options): unknown key \"foo\" "
                        + "(find accepts sort, limit, skip, maxTimeMS, collation, hint, comment)"),
                CodeRules.problems("mongo", "find", "[{}, [], {\"foo\": 1}]"), "one problem per argument");
        assertEquals("[\n  { \"ativo\": true }\n]", CodeRules.formatted("mongo", "[ {\"ativo\" :true} ]"));
        assertNull(CodeRules.formatted("rawvalue", "{}"));
    }

    @Test
    void mongoWithoutSubtypeHasNoRuleYet() {
        // the missing subtype itself is reported by the card/script validation
        assertNull(CodeRules.problem("mongo", null, "db.x.find()"));
        assertEquals("arg 1 (pipeline): stage \"$out\" is not allowed in mongo cards",
                CodeRules.problem("mongo", "aggregation", "[[{\"$out\": \"y\"}]]"));
    }

    @Test
    void oracleAcceptsOneSelectOnly() {
        assertNull(CodeRules.problem("sql", "oracle", "SELECT * FROM products WHERE ativo = 1"));
        assertNull(CodeRules.problem("sql", "oracle", "-- ok\nselect 1 from dual;"));
        assertNull(CodeRules.problem("sql", "oracle", ""));
        assertEquals("oracle cards accept a single SELECT statement",
                CodeRules.problem("sql", "oracle", "DELETE FROM products"));
        assertEquals("only one SELECT statement is allowed",
                CodeRules.problem("sql", "oracle", "SELECT 1 FROM dual; DROP TABLE products"));
        assertNull(CodeRules.problem("sql", "oracle", "SELECT ';' AS sep FROM dual"), "semicolons inside strings do not split");
        assertNull(CodeRules.problem("sql", "postgres", "DELETE FROM products"), "only oracle has a rule");
    }

    @Test
    void scriptLinesAreAssertsOrExpressions() {
        assertNull(CodeRules.problem("jsonassert", "script", "assert $count(activeProducts) > 0\nassert status == \"PROCESSADO\""));
        assertNull(CodeRules.problem("jsonassert", "script", "// filter, then map\nitems[price > 10].name"));
        assertNull(CodeRules.problem("jsonassert", "script", "// draft"));
        assertNull(CodeRules.problem("jsonassert", "script", ""));
        assertTrue(CodeRules.problem("jsonassert", "script", "assert $count(items) > 0\nexpect(res.status).toBe(200);")
                .startsWith("not a jsonassert expression: expect(res.status).toBe(200);"));
        assertTrue(CodeRules.problem("jsonassert", "script", "assert items")
                .startsWith("not a jsonassert assert line: assert items"));
    }

    @Test
    void conditionalIsExactlyOneBareExpression() {
        assertNull(CodeRules.problem("jsonassert", "conditional", "$count(activeProducts) > 0"));
        assertNull(CodeRules.problem("jsonassert", "conditional", "// only when there are products\n$count(activeProducts) > 0"));
        assertEquals("a conditional holds exactly one boolean expression",
                CodeRules.problem("jsonassert", "conditional", "a > 1\nb > 2"));
        assertEquals("a conditional is a bare boolean expression (no assert): assert a > 1",
                CodeRules.problem("jsonassert", "conditional", "assert a > 1"));
        assertTrue(CodeRules.problem("jsonassert", "conditional", "a >").startsWith("not a jsonassert expression: a >"));
    }

    @Test
    void kindsWithoutRulesAcceptAnything() {
        assertNull(CodeRules.problem("openapi", "restapi", "{ \"a\": 1 }"));
        assertNull(CodeRules.problem("rawvalue", "json", "not even close"));
        assertNull(CodeRules.problem(null, null, "x"));
    }
}
