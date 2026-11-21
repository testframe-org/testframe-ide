package com.testframe.server.controller;

import io.github.jsonassert.JsonataAssertionService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AssertionControllerTest {

    private final MockMvc mvc = MockMvcBuilders
            .standaloneSetup(new AssertionController(new JsonataAssertionService()))
            .build();

    private static final String SUM_BODY = """
            {"expression": "assert $sum(Account.Order.Product.(Price * Quantity)) == 336.36",
             "input": {"Account": {"Order": {"Product": [
               {"Price": 59.99, "Quantity": 2}, {"Price": 24.99, "Quantity": 3},
               {"Price": 45.00, "Quantity": 2}, {"Price": 51.41, "Quantity": 1}]}}}}
            """;

    @Test
    void passesTheSumCase() throws Exception {
        mvc.perform(post("/api/v2/assertions")
                        .contentType("application/json")
                        .content(SUM_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.passed").value(true))
                .andExpect(jsonPath("$.jsonata")
                        .value("$sum(Account.Order.Product.(Price * Quantity)) = 336.36"));
    }

    @Test
    void reportsFailedAssertion() throws Exception {
        String body = "{\"expression\": \"assert $sum(Account.Order.Product.Price) == 1\","
                + " \"input\": {\"Account\": {\"Order\": {\"Product\": [{\"Price\": 10}]}}}}";

        mvc.perform(post("/api/v2/assertions")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.passed").value(false));
    }

    @Test
    void rejectsInvalidLineWith400() throws Exception {
        mvc.perform(post("/api/v2/assertions")
                        .contentType("application/json")
                        .content("{\"expression\": \"assert $sum(\", \"input\": {}}"))
                .andExpect(status().isBadRequest());
    }
}
