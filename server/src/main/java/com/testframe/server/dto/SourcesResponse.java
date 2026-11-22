package com.testframe.server.dto;

import java.util.List;

/** Sources of a project plus the invalid source files found while reading them. */
public record SourcesResponse(List<Source> sources, List<String> errors) {
}
