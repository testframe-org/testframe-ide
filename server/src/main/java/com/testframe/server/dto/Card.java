package com.testframe.server.dto;

import lombok.With;

/**
 * One card of a frame as exchanged with the editor. Identity on disk is
 * {@code frames/{frame}/step-{n}/{var-file}.md} and the card's place in the step comes from
 * {@code flow.md}; {@code sourceType} is always set ({@code rawvalue} for cards without a named
 * source) and {@code subtype} is set when the type has subtypes; {@code type} and
 * {@code httpMethod} are derived (from (sourceType, subtype) and the endpoint) and ignored on save, as is {@code lastRun}. Null
 * {@code timeout}/{@code width}/{@code height} mean the defaults of the card type.
 * {@code collection} (mongo cards) is the collection the query reads.
 * {@code openapiId} (openapi cards) is the spec operation's operationId: the card's operation
 * identity, with {@code endpoint} its {@code METHOD /path} as last seen in the spec.
 * Lombok {@code @With} generates the copy-on-write helpers ({@code withVarName},
 * {@code withCode}, {@code withPrivateData}, {@code withLastRun}).
 */
@With
public record Card(
        String varName,
        String title,
        String type,
        String sourceType,
        String subtype,
        String collection,
        String sourceName,
        String endpoint,
        String openapiId,
        String httpMethod,
        Integer timeout,
        Integer width,
        Integer height,
        Integer resultHeight,
        String code,
        String privateData,
        CardRun lastRun
) {
}
