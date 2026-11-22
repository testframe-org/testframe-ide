package com.testframe.server.runner;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Executes the HTTP calls of request cards from the server (java.net.http): no browser CORS
 * applies, so in-test requests can target the framework server itself (relative paths such as
 * {@code POST /api/v2/echo}) or any absolute URL. Errors never throw: a refused connection or
 * a timeout comes back as status 0 with the reason as the body.
 */
public class HttpRequestRunner {

    /** Status 0 means the call never got an HTTP response (network error, bad URL). */
    public record Response(int status, String body, long ms) {

        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }

    private final HttpClient client;

    public HttpRequestRunner() {
        this(HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofSeconds(5))
                .build());
    }

    public HttpRequestRunner(HttpClient client) {
        this.client = client;
    }

    /** Relative endpoint paths run against the framework server's own base URL; absolute URLs pass through. */
    public static String resolveUrl(String serverBaseUrl, String path) {
        if (path.matches("(?i)^https?://.*")) {
            return path;
        }
        String base = serverBaseUrl == null ? "" : serverBaseUrl.replaceAll("/+$", "");
        return path.startsWith("/") ? base + path : base + "/" + path;
    }

    public Response run(String method, String url, String jsonBody, long timeoutMs) {
        long started = System.nanoTime();
        try {
            HttpRequest.BodyPublisher body = jsonBody == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(jsonBody);
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .method(method, body);
            if (jsonBody != null) {
                builder.header("Content-Type", "application/json");
            }
            HttpResponse<String> res = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            return new Response(res.statusCode(), res.body() == null ? "" : res.body(), elapsed(started));
        } catch (IOException | InterruptedException | IllegalArgumentException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            String reason = e.getMessage() == null ? e.getClass().getSimpleName()
                    : e.getClass().getSimpleName() + ": " + e.getMessage();
            return new Response(0, reason, elapsed(started));
        }
    }

    private static long elapsed(long startedNanos) {
        return Math.round((System.nanoTime() - startedNanos) / 1e6);
    }
}
