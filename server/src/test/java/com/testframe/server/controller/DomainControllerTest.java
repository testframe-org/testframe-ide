package com.testframe.server.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DomainControllerTest {

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new DomainController()).build();

    @Test
    void catalogServesTheDomainDefinitions() throws Exception {
        mvc.perform(get("/api/v2/catalog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceTypes.length()").value(14))
                .andExpect(jsonPath("$.sourceTypes[0].name").value("restapi"))
                .andExpect(jsonPath("$.sourceTypes[0].cardType").value("request"))
                .andExpect(jsonPath("$.sourceTypes[0].language").value("js"))
                .andExpect(jsonPath("$.sourceTypes[0].defaultWidth").value(320))
                .andExpect(jsonPath("$.sourceTypes[0].defaultTimeout").value(5000))
                .andExpect(jsonPath("$.sourceTypes[1].hasScripts").value(false))
                .andExpect(jsonPath("$.sourceTypes[6].name").value("mongo"))
                .andExpect(jsonPath("$.sourceTypes[6].cardType").value("js"))
                .andExpect(jsonPath("$.sourceTypes[4].cardType").value("validation"))
                .andExpect(jsonPath("$.sourceTypes[4].defaultTimeout").value(1000))
                .andExpect(jsonPath("$.sourceTypes[13].cardType").value("json"))
                .andExpect(jsonPath("$.httpMethods").value(org.hamcrest.Matchers.contains("GET", "POST", "PUT", "PATCH", "DELETE")))
                .andExpect(jsonPath("$.mongoOps").value(org.hamcrest.Matchers.contains(
                        "find", "findOne", "aggregate", "countDocuments", "distinct")));
    }

    @Test
    void validateReturnsTheCodeRuleProblemOrNull() throws Exception {
        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"mongo\", \"code\": \"db.products.deleteMany({})\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").value("mongo operation \"deleteMany\" is not allowed (find, findOne, aggregate, countDocuments, distinct)"));

        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"mongo\", \"code\": \"db.products.find({ ativo: true })\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").doesNotExist());

        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"assert\", \"code\": \"expect(x).toBe(y)\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").value("not a jsonassert line: expect(x).toBe(y)"));

        mvc.perform(post("/api/v2/validate").contentType("application/json")
                        .content("{\"sourceType\": \"restapi\", \"code\": \"anything\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.problem").doesNotExist());
    }
}
