package com.testframe.server.format;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class MdEnvelopeTest {

    @Test
    void rendersFieldsInOrderOmittingEmptyValues() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("title", "Get data");
        fields.put("order", 1);
        fields.put("source", null);
        fields.put("endpoint", "");
        fields.put("timeout", 5000);
        assertEquals("""
                -------------------
                title: Get data
                order: 1
                timeout: 5000
                -------------------
                ```js
                db.x.find()
                ```
                """, MdEnvelope.render(fields, MdEnvelope.fence("js", "db.x.find()\n\n\n")));
    }

    @Test
    void emptyBodyEndsRightAfterTheClosingSeparator() {
        assertEquals("-------------------\n-------------------\n", MdEnvelope.render(""));
        assertEquals("-------------------\n-------------------\n", MdEnvelope.render("\n\n"));
        assertEquals("-------------------\n-------------------\n", MdEnvelope.render(Map.of(), null));
        assertEquals("", MdEnvelope.fence("js", "  \n"));
    }

    @Test
    void parsesFieldsAndBody() {
        MdEnvelope.Parsed md = MdEnvelope.parse("""
                -------------------
                title: Get data
                base-url: mongodb://localhost:27017/x
                empty:
                not a field
                -------------------
                line 1

                line 3


                """);
        assertEquals(Map.of("title", "Get data", "base-url", "mongodb://localhost:27017/x", "empty", ""), md.fields());
        assertEquals("line 1\n\nline 3", md.body());
    }

    @Test
    void handlesCrlfAndKeepsLeadingBlankLines() {
        MdEnvelope.Parsed md = MdEnvelope.parse("-------------------\r\ntitle: A\r\n-------------------\r\n\r\nbody\n");
        assertEquals("A", md.fields().get("title"));
        assertEquals("\nbody", md.body());
    }

    @Test
    void withoutFrontmatterEverythingIsBody() {
        MdEnvelope.Parsed md = MdEnvelope.parse("title: A\nfree text");
        assertEquals(Map.of(), md.fields());
        assertEquals("title: A\nfree text", md.body());
        assertEquals("", MdEnvelope.parse(null).body());
    }

    @Test
    void fencesRoundTripAndOutgrowBackticksInTheCode() {
        String code = "assert $count(activeProducts) > 0";
        assertEquals("```jsonassert\n" + code + "\n```", MdEnvelope.fence("jsonassert", code));
        assertEquals(code, MdEnvelope.unfence(MdEnvelope.fence("jsonassert", code)));

        String withTicks = "const md = ```x```;";
        String fenced = MdEnvelope.fence("js", withTicks);
        assertEquals("````js\n" + withTicks + "\n````", fenced);
        assertEquals(withTicks, MdEnvelope.unfence(fenced));

        assertEquals("plain text", MdEnvelope.unfence("plain text"));
        assertEquals("", MdEnvelope.unfence("```json\n```"));
    }

    @Test
    void renderThenParseRoundTrips() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("status", "success");
        fields.put("summary", "ok: 2 docs");
        String md = MdEnvelope.render(fields, MdEnvelope.fence("json", "[1, 2]"));
        MdEnvelope.Parsed parsed = MdEnvelope.parse(md);
        assertEquals(Map.of("status", "success", "summary", "ok: 2 docs"), parsed.fields());
        assertEquals("[1, 2]", MdEnvelope.unfence(parsed.body()));
        assertEquals(md, MdEnvelope.render(new LinkedHashMap<>(parsed.fields()), parsed.body()));
    }
}
