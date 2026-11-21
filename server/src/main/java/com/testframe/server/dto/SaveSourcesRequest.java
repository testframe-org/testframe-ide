package com.testframe.server.dto;

import java.util.List;

public record SaveSourcesRequest(String project, List<SourceDefinition> sources) {
}
