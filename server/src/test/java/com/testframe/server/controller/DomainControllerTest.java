package com.testframe.server.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DomainControllerTest {

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new DomainController()).build();

    @Test
    void catalogServesTypesWithTheirSubtypes() throws Exception {
        mvc.perform(get("/api/v2/catalog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceTypes[*].name").value(contains("openapi", "mongo", "sql", "jsonassert", "kafka", "grpc", "rawvalue")))
                .andExpect(jsonPath("$.sourceTypes[0].subtypes").value(contains("restapi", "swagger", "graphql")))
                .andExpect(jsonPath("$.sourceTypes[0].hasSources").value(true))
                .andExpect(jsonPath("$.sourceTypes[0].cards[0].cardType").value("request"))
                .andExpect(jsonPath("$.sourceTypes[0].cards[0].language").value("js"))
                .andExpect(jsonPath("$.sourceTypes[0].cards[0].defaultWidth").value(320))
                .andExpect(jsonPath("$.sourceTypes[0].cards[0].defaultTimeout").value(5000))
                .andExpect(jsonPath("$.sourceTypes[0].cards[1].subtype").value("swagger"))
                .andExpect(jsonPath("$.sourceTypes[0].cards[1].form").value("swagger"))
                .andExpect(jsonPath("$.sourceTypes[1].subtypes").value(contains("find", "aggregation")))
                .andExpect(jsonPath("$.sourceTypes[1].language").value("json"))
                .andExpect(jsonPath("$.sourceTypes[1].cards[1].cardType").value("query"))
                .andExpect(jsonPath("$.sourceTypes[1].cards[1].form").value("mongo"))
                .andExpect(jsonPath("$.sourceTypes[2].subtypes").value(contains("oracle", "postgres", "mysql", "sqlserver")))
                .andExpect(jsonPath("$.sourceTypes[3].hasSources").value(false))
                .andExpect(jsonPath("$.sourceTypes[3].subtypes").value(contains("script", "conditional")))
                .andExpect(jsonPath("$.sourceTypes[3].cards[0].cardType").value("jsonassert"))
                .andExpect(jsonPath("$.sourceTypes[3].cards[0].form").value("script"))
                .andExpect(jsonPath("$.sourceTypes[3].cards[1].cardType").value("condition"))
                .andExpect(jsonPath("$.sourceTypes[3].cards[1].defaultTimeout").value(1000))
                .andExpect(jsonPath("$.sourceTypes[4].subtypes").isEmpty())
                .andExpect(jsonPath("$.sourceTypes[4].cards[0].subtype").doesNotExist())
                .andExpect(jsonPath("$.sourceTypes[6].subtypes").value(contains("json")))
                .andExpect(jsonPath("$.sourceTypes[6].cards[0].cardType").value("json"))
                .andExpect(jsonPath("$.httpMethods").value(contains("GET", "POST", "PUT", "PATCH", "DELETE")));
    }

    @Test
    void validateReturnsTheCodeRuleProblemOrNull() throws Exception {
        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"mongo\", \"subtype\": \"aggregation\", \"code\": \"{\\\"pipeline\\\": [{\\\"$out\\\": \\\"y\\\"}]}\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").value("write stage \"$out\" is not allowed (mongo cards are read-only)"));

        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"mongo\", \"subtype\": \"find\", \"code\": \"{\\\"filter\\\": {}}\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").doesNotExist());

        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"jsonassert\", \"subtype\": \"conditional\", \"code\": \"assert x > 1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").value("a conditional is a bare boolean expression (no assert): assert x > 1"));

        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"openapi\", \"subtype\": \"restapi\", \"code\": \"anything\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").doesNotExist());
    }
}
