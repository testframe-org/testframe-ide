package com.testframe.server.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

@RestController
@RequestMapping("/api/v2")
public class FrameworkController {

    private final AtomicInteger sequencial = new AtomicInteger(0);

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "UP", "servico", "testframe-server");
    }

    @PostMapping("/echo")
    public ResponseEntity<Map<String, Object>> echo(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("request_id", "REQ-%d".formatted(sequencial.incrementAndGet()));
        response.put("status", "PROCESSADO");
        response.put("received_at", Instant.now().toString());
        response.put("echo", body == null ? Map.of() : body);
        return ResponseEntity.status(201).body(response);
    }
}
