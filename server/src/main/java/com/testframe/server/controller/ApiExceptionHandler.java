package com.testframe.server.controller;

import com.testframe.server.format.FormatException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** Errors carry their reason in the body ({@code {status, message}}) so the editor can show it. */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> status(ResponseStatusException e) {
        return body(e.getStatusCode().value(), String.valueOf(e.getReason()));
    }

    @ExceptionHandler(FormatException.class)
    public ResponseEntity<Map<String, Object>> format(FormatException e) {
        return body(HttpStatus.BAD_REQUEST.value(), e.getMessage());
    }

    private static ResponseEntity<Map<String, Object>> body(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("status", status, "message", message));
    }
}
