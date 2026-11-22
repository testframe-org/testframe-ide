package com.testframe.server;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The runner against the live HTTP stack: request cards with relative paths hit the framework
 * server itself ({@code POST /api/v2/echo}) through its own base URL, and the published
 * variables flow into the assert card — the full frame run, over real sockets.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RunEndpointIntegrationTest {

    @Autowired
    Environment env;

    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient client = HttpClient.newHttpClient();

    private Map<String, Object> post(String path, Map<String, Object> body) throws Exception {
        int port = Integer.parseInt(env.getProperty("local.server.port"));
        HttpResponse<String> res = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, res.statusCode(), res.body());
        return json.readValue(res.body(), Map.class);
    }

    @Test
    void frameRunExecutesRequestsAgainstTheFrameworkServerItself() throws Exception {
        Map<String, Object> response = post("/api/v2/run", Map.of(
                "project", "integration", "frame", "echo-flow",
                "steps", List.of(Map.of("number", 1, "cards", List.of(
                        Map.of("varName", "payload", "title", "Payload", "sourceType", "inline",
                                "code", "{\"hello\": \"world\"}"),
                        Map.of("varName", "send", "title", "Send", "sourceType", "restapi",
                                "endpoint", "POST /api/v2/echo", "code", ""),
                        Map.of("varName", "check", "title", "Check", "sourceType", "assert",
                                "code", "assert send.status == \"PROCESSADO\""))))));

        List<Map<String, Object>> results = (List<Map<String, Object>>) response.get("results");
        assertEquals(List.of("success", "success", "success"), results.stream().map(r -> r.get("status")).toList());
        assertTrue(results.get(1).get("text").toString().startsWith("[Step 1] Send: HTTP 201 ("),
                results.get(1).get("text").toString());
        assertNotNull(results.get(1).get("ranAt"));
        Map<String, Object> vars = (Map<String, Object>) response.get("vars");
        assertEquals("PROCESSADO", ((Map<String, Object>) vars.get("send")).get("status"));
        assertEquals("world", ((Map<String, Object>) ((Map<String, Object>) vars.get("send")).get("echo")).get("hello"));
        assertTrue((Boolean) ((Map<String, Object>) vars.get("check")).get("passed"));
    }

    @Test
    void singleCardRunAnswersThroughTheSameEngine() throws Exception {
        Map<String, Object> response = post("/api/v2/run/card", Map.of(
                "project", "integration", "step", 1,
                "card", Map.of("varName", "solo", "title", "Solo", "sourceType", "restapi",
                        "endpoint", "POST /api/v2/echo", "code", ""),
                "vars", Map.of(), "payload", "{\"a\": 1}", "resultCard", Map.of("varName", "out", "code", "{}")));

        Map<String, Object> result = (Map<String, Object>) response.get("result");
        assertEquals("success", result.get("status"));
        Map<String, Object> vars = (Map<String, Object>) response.get("vars");
        assertEquals(1, ((Map<String, Object>) ((Map<String, Object>) vars.get("out")).get("echo")).get("a"));
    }
}
