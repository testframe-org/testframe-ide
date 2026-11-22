package com.testframe.server.format;

import java.util.List;

/**
 * Source types and the card defaults derived from them. The card type is never stored: it
 * follows the card's source type and drives the default size and timeout.
 */
public final class Catalog {

    public static final List<String> SOURCE_TYPES = List.of(
            "restapi", "swagger", "filter", "mapper", "assert", "kafka", "mongo",
            "oracle", "postgres", "mysql", "sqlserver", "graphql", "grpc", "inline");

    public static final List<String> HTTP_METHODS = List.of("GET", "POST", "PUT", "PATCH", "DELETE");

    public record Size(int width, int height) {
    }

    private Catalog() {
    }

    /** restapi/graphql/swagger → request, oracle/postgres/mysql/sqlserver → sql, filter/mapper → jsonassert,
     *  assert → validation, inline/none → json, anything else (mongo, kafka, grpc) → js. */
    public static String cardTypeOf(String sourceType) {
        return switch (sourceType == null ? "" : sourceType) {
            case "restapi", "graphql", "swagger" -> "request";
            case "assert" -> "validation";
            case "oracle", "postgres", "mysql", "sqlserver" -> "sql";
            case "filter", "mapper" -> "jsonassert";
            case "inline", "" -> "json";
            default -> "js";
        };
    }

    /** Language of the fenced code block of a card/script, by source type. */
    public static String languageOf(String sourceType) {
        return switch (sourceType == null ? "" : sourceType) {
            case "oracle", "postgres", "mysql", "sqlserver" -> "sql";
            case "assert", "filter", "mapper" -> "jsonassert";
            case "swagger", "inline", "" -> "json";
            default -> "js"; // restapi, graphql, mongo, kafka, grpc
        };
    }

    public static Size defaultSize(String cardType) {
        return switch (cardType) {
            case "jsonassert" -> new Size(300, 190);
            case "json" -> new Size(290, 185);
            case "validation" -> new Size(240, 165);
            default -> new Size(320, 210); // request, js, sql
        };
    }

    public static int defaultTimeout(String cardType) {
        return switch (cardType) {
            case "jsonassert", "json" -> 2000;
            case "validation" -> 1000;
            default -> 5000; // request, js, sql
        };
    }

    /** swagger sources rely on the OpenAPI spec at base-url: no scripts. */
    public static boolean hasScripts(String typeSource) {
        return !"swagger".equals(typeSource);
    }
}
