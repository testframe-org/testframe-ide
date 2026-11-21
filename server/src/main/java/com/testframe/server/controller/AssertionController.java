package com.testframe.server.controller;

import io.github.jsonassert.AssertionResult;
import io.github.jsonassert.JsonataAssertionService;
import io.github.jsonassert.JsonataException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestController
@RequestMapping("/api/v2")
public class AssertionController {

    public record AssertionRequest(String expression, Map<String, Object> input) {
    }

    private final JsonataAssertionService service;

    public AssertionController(JsonataAssertionService service) {
        this.service = service;
    }

    /** HTTP 200 with passed=true/false for assertion outcomes; 400 for malformed expressions. */
    @PostMapping("/assertions")
    public AssertionResult evaluate(@RequestBody AssertionRequest request) {
        try {
            return service.evaluate(request.expression(), request.input());
        } catch (JsonataException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage(), e);
        }
    }
}
