package com.testframe.server.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * One source: {@code sources/{typeSource}/{name}.md} (base-url + public data),
 * {@code {name}.private.md} and the scripts under {@code {name}/}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Source(
        String typeSource,
        String name,
        String baseUrl,
        String publicData,
        String privateData,
        List<SourceScript> scripts
) {
}
