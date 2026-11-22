package com.testframe.server.openapi;

import com.testframe.server.service.SourceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * The operations of an {@code openapi} source. The source's base-url is its OpenAPI spec URL;
 * the spec is distilled into {@code sources/openapi/{name}.cache.md} (gitignored: API base,
 * spec URL, fetched-at and the operations), which is the source of truth afterwards: the
 * operations endpoint, the card editor, the runner's URL resolution and the endpoint
 * validation read the cache. It is rewritten when the source is saved; a missing cache (or
 * one made from another spec URL) is fetched once and written. A spec that cannot be fetched or is not OpenAPI is a 502.
 */
@Service
public class OpenApiService {

    public static final String TYPE = "openapi";

    /** Fetches a document by URL (swapped by tests); throws IOException with the reason. */
    @FunctionalInterface
    public interface Fetcher {
        String fetch(String url) throws IOException;
    }

    private final SourceService sources;
    private final Fetcher fetcher;

    @Autowired
    public OpenApiService(SourceService sources) {
        this(sources, httpFetcher());
    }

    public OpenApiService(SourceService sources, Fetcher fetcher) {
        this.sources = sources;
        this.fetcher = fetcher;
    }

    /** The cached operations of a saved openapi source (fetched once when the cache is missing or stale). */
    public OpenApiSpec spec(String project, String sourceName) throws IOException {
        String specUrl = sources.baseUrl(project, TYPE, sourceName);
        Optional<String> cached = sources.readCache(project, TYPE, sourceName);
        if (cached.isPresent()) {
            try {
                OpenApiSpec spec = OpenApiSpec.fromCache(cached.get());
                if (spec.specUrl().equals(specUrl)) {
                    return spec;
                }
            } catch (IllegalArgumentException ignored) {
                // unreadable cache: fetch again below
            }
        }
        return refresh(project, sourceName);
    }

    /** Fetches the spec at the source's base-url and rewrites its cache (on source save). */
    public OpenApiSpec refresh(String project, String sourceName) throws IOException {
        String specUrl = sources.baseUrl(project, TYPE, sourceName);
        String document;
        try {
            document = fetcher.fetch(specUrl);
        } catch (IOException | RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "cannot read the OpenAPI spec at " + specUrl + ": " + reason(e), e);
        }
        OpenApiSpec spec;
        try {
            spec = OpenApiSpec.parse(specUrl, Instant.now().toString(), document);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, e.getMessage(), e);
        }
        sources.writeCache(project, TYPE, sourceName, spec.toCache());
        return spec;
    }

    private static String reason(Exception e) {
        return e.getMessage() == null ? e.getClass().getSimpleName() : e.getClass().getSimpleName() + ": " + e.getMessage();
    }

    private static Fetcher httpFetcher() {
        HttpClient client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofSeconds(3))
                .build();
        return url -> {
            try {
                HttpResponse<String> res = client.send(HttpRequest.newBuilder(URI.create(url))
                                .timeout(Duration.ofSeconds(5)).header("Accept", "application/json").GET().build(),
                        HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() < 200 || res.statusCode() >= 300) {
                    throw new IOException("HTTP " + res.statusCode());
                }
                return res.body();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("interrupted", e);
            }
        };
    }
}
