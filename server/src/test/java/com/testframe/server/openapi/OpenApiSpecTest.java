package com.testframe.server.openapi;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenApiSpecTest {

    /** Shaped like springdoc's output for the example product-api. */
    static final String PRODUCT_API = """
            {"openapi": "3.1.0", "servers": [{"url": "http://localhost:18081", "description": "Generated server url"}],
             "paths": {
               "/api/products": {
                 "get": {"operationId": "list", "summary": "Listar produtos",
                         "parameters": [{"name": "categoria", "in": "query", "required": false, "schema": {"type": "string"}},
                                        {"name": "ativos", "in": "query", "schema": {"type": "boolean"}}],
                         "responses": {"200": {"description": "OK", "content": {"application/json":
                           {"schema": {"type": "array", "items": {"$ref": "#/components/schemas/Product"}}}}}}},
                 "post": {"operationId": "create", "summary": "Criar produto",
                          "requestBody": {"required": true, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Product"}}}},
                          "responses": {"201": {"description": "Created", "content": {"*/*": {"schema": {"$ref": "#/components/schemas/Product"}}}},
                                        "400": {"description": "Bad"}}}
               },
               "/api/products/{id}": {
                 "parameters": [{"name": "id", "in": "path", "schema": {"type": "string"}}],
                 "get": {"operationId": "byId", "summary": "Buscar produto por id", "responses": {"200": {"description": "OK"}}},
                 "delete": {"operationId": "delete", "summary": "Excluir produto", "responses": {"204": {"description": "No Content"}}}
               }
             },
             "components": {"schemas": {
               "Product": {"type": "object", "properties": {"id": {"type": "string"}, "nome": {"type": "string"},
                 "categoria": {"type": "string"}, "preco": {"type": "number"}, "ativo": {"type": "boolean"},
                 "parent": {"$ref": "#/components/schemas/Product"}}}
             }}}
            """;

    @Test
    void readsTheOperations() {
        OpenApiSpec spec = OpenApiSpec.parse("http://localhost:18081/api/docs/openapi.json", "t0", PRODUCT_API);
        assertEquals("http://localhost:18081", spec.baseUrl());
        assertEquals(List.of(
                        new OpenApiSpec.Operation("list", "GET", "/api/products", "Listar produtos"),
                        new OpenApiSpec.Operation("create", "POST", "/api/products", "Criar produto"),
                        new OpenApiSpec.Operation("byId", "GET", "/api/products/{id}", "Buscar produto por id"),
                        new OpenApiSpec.Operation("delete", "DELETE", "/api/products/{id}", "Excluir produto")),
                spec.operations(), "paths-level keys such as parameters are not operations");
        assertTrue(spec.has("POST   /api/products"));
        assertFalse(spec.has("POST /api/v2/echo"));
        assertEquals("http://localhost:18081/api/products", spec.urlOf("/api/products"));
        assertEquals("POST /api/products", spec.byId("create").orElseThrow().endpoint());
        assertTrue(spec.byId("nope").isEmpty());
    }

    @Test
    void baseUrlFallsBackToTheSpecOriginAndResolvesRelativeServers() {
        String noServers = "{\"paths\": {}}";
        assertEquals("http://h:1", OpenApiSpec.parse("http://h:1/docs/openapi.json", "t", noServers).baseUrl());
        String relative = "{\"servers\": [{\"url\": \"/v2/\"}], \"paths\": {}}";
        assertEquals("http://h:1/v2", OpenApiSpec.parse("http://h:1/docs/openapi.json", "t", relative).baseUrl());
        String swagger2 = "{\"swagger\": \"2.0\", \"host\": \"api.local:9\", \"basePath\": \"/b\", \"paths\": {}}";
        assertEquals("http://api.local:9/b", OpenApiSpec.parse("http://h:1/spec", "t", swagger2).baseUrl());
    }

    @Test
    void rejectsDocumentsThatAreNotSpecs() {
        assertThrows(IllegalArgumentException.class, () -> OpenApiSpec.parse("http://h/x", "t", "<html>"));
        assertThrows(IllegalArgumentException.class, () -> OpenApiSpec.parse("http://h/x", "t", "{\"openapi\": \"3\"}"));
    }

    @Test
    void cacheFileRoundTrips() {
        OpenApiSpec spec = OpenApiSpec.parse("http://localhost:18081/api/docs/openapi.json", "2026-11-22T00:00:00Z", PRODUCT_API);
        String cache = spec.toCache();
        assertEquals("""
                -------------------
                spec-url: http://localhost:18081/api/docs/openapi.json
                api-base: http://localhost:18081
                fetched-at: 2026-11-22T00:00:00Z
                -------------------
                ```json
                [ {
                  "operationId" : "list",
                  "method" : "GET",
                  "path" : "/api/products",
                  "summary" : "Listar produtos"
                }, {
                  "operationId" : "create",
                  "method" : "POST",
                  "path" : "/api/products",
                  "summary" : "Criar produto"
                }, {
                  "operationId" : "byId",
                  "method" : "GET",
                  "path" : "/api/products/{id}",
                  "summary" : "Buscar produto por id"
                }, {
                  "operationId" : "delete",
                  "method" : "DELETE",
                  "path" : "/api/products/{id}",
                  "summary" : "Excluir produto"
                } ]
                ```
                """, cache);
        assertEquals(spec, OpenApiSpec.fromCache(cache));
        assertThrows(IllegalArgumentException.class, () -> OpenApiSpec.fromCache("-------------------\n-------------------\n"));
    }
}
