package com.testframe.server.openapi;

import com.testframe.server.format.MdEnvelope;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * What an {@code openapi} source offers to its cards, distilled from its OpenAPI (or Swagger 2)
 * document: the API base URL ({@code servers[0].url} resolved against the spec URL; the spec
 * URL's origin when the document names no server) and the fixed list of operations. This is
 * exactly what the source's {@code {name}.cache.md} stores; frames read the cache.
 */
public record OpenApiSpec(String specUrl, String baseUrl, String fetchedAt, List<Operation> operations) {

    /**
     * One operation: {@code operationId} is its identity (a card's {@code openapi-id});
     * {@link #endpoint()} is how cards store its method + path ({@code METHOD /path}).
     */
    public record Operation(String operationId, String method, String path, String summary) {

        public String endpoint() {
            return method + " " + path;
        }
    }

    private static final List<String> METHODS = List.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final TypeReference<List<Operation>> OPERATIONS = new TypeReference<>() {
    };

    /** Parses an OpenAPI (or Swagger 2) JSON document; IllegalArgumentException when it is not one. */
    public static OpenApiSpec parse(String specUrl, String fetchedAt, String document) {
        JsonNode root;
        try {
            root = JSON.readTree(document == null ? "" : document);
        } catch (JacksonException e) {
            throw new IllegalArgumentException("the spec at " + specUrl + " is not JSON: " + e.getOriginalMessage());
        }
        if (root == null || !root.isObject() || !root.path("paths").isObject()) {
            throw new IllegalArgumentException("the document at " + specUrl + " is not an OpenAPI spec (no \"paths\")");
        }
        List<Operation> operations = new ArrayList<>();
        for (Map.Entry<String, JsonNode> path : root.path("paths").properties()) {
            if (!path.getValue().isObject()) {
                continue;
            }
            for (Map.Entry<String, JsonNode> op : path.getValue().properties()) {
                String method = op.getKey().toUpperCase(Locale.ROOT);
                if (METHODS.contains(method) && op.getValue().isObject()) {
                    operations.add(new Operation(text(op.getValue(), "operationId"), method, path.getKey(),
                            text(op.getValue(), "summary")));
                }
            }
        }
        return new OpenApiSpec(specUrl, baseUrlOf(specUrl, root), fetchedAt, List.copyOf(operations));
    }

    /** Whether {@code endpoint} ({@code METHOD /path}) is one of the spec's operations. */
    public boolean has(String endpoint) {
        String wanted = endpoint == null ? "" : endpoint.trim().replaceAll("\\s+", " ");
        return operations.stream().anyMatch(o -> o.endpoint().equalsIgnoreCase(wanted));
    }

    /** The operation whose operationId is {@code operationId}. */
    public Optional<Operation> byId(String operationId) {
        return operationId == null || operationId.isBlank() ? Optional.empty()
                : operations.stream().filter(o -> o.operationId().equals(operationId.trim())).findFirst();
    }

    /** The URL a request to {@code path} goes to: the API base + path. */
    public String urlOf(String path) {
        String base = baseUrl.replaceAll("/+$", "");
        return path.startsWith("/") ? base + path : base + "/" + path;
    }

    // ------------------------------------------------------------- cache file

    /**
     * The source's {@code {name}.cache.md}: frontmatter {@code spec-url}, {@code api-base},
     * {@code fetched-at}; body = the operations ({@code operationId, method, path, summary}) as one fenced json block.
     */
    public String toCache() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("spec-url", specUrl);
        fields.put("api-base", baseUrl);
        fields.put("fetched-at", fetchedAt);
        return MdEnvelope.render(fields, MdEnvelope.fence("json",
                JSON.writerWithDefaultPrettyPrinter().writeValueAsString(operations)));
    }

    /** Reads a {@code {name}.cache.md}; IllegalArgumentException when it is not a valid cache. */
    public static OpenApiSpec fromCache(String content) {
        MdEnvelope.Parsed md = MdEnvelope.parse(content);
        String specUrl = md.fields().get("spec-url");
        String baseUrl = md.fields().get("api-base");
        if (specUrl == null || baseUrl == null) {
            throw new IllegalArgumentException("not an openapi cache (spec-url and api-base are required)");
        }
        try {
            List<Operation> operations = JSON.readValue(MdEnvelope.unfence(md.body()), OPERATIONS);
            return new OpenApiSpec(specUrl, baseUrl, md.fields().getOrDefault("fetched-at", ""), List.copyOf(operations));
        } catch (JacksonException e) {
            throw new IllegalArgumentException("unreadable openapi cache: " + e.getOriginalMessage());
        }
    }

    private static String baseUrlOf(String specUrl, JsonNode root) {
        URI spec = URI.create(specUrl);
        String origin = spec.getScheme() + "://" + spec.getRawAuthority();
        String server = text(root.path("servers").path(0), "url");
        if (server.isEmpty()) {
            String host = text(root, "host"); // Swagger 2: host + basePath
            return host.isEmpty() ? origin : spec.getScheme() + "://" + host + text(root, "basePath");
        }
        return spec.resolve(server).toString().replaceAll("/+$", "");
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isString() ? value.asString() : "";
    }
}
