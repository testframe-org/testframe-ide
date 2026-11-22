package com.testframe.server.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One source, only its connection: {@code sources/{typeSource}/{name}.md} (frontmatter
 * {@code base-url}, no body) and the optional {@code {name}.private.md} (gitignored).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Source(
        String typeSource,
        String name,
        String baseUrl,
        String privateData
) {
}
