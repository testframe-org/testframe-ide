package com.testframe.server.dto;

import java.util.List;

public record SourceDefinition(
        String typeSource,
        String name,
        String publicData,
        String privateData,
        List<SourceScript> scripts
) {

    public SourceDefinition withPrivateData(String content) {
        return new SourceDefinition(typeSource, name, publicData, content, scripts);
    }

    public SourceDefinition withPublicData(String content) {
        return new SourceDefinition(typeSource, name, content, privateData, scripts);
    }

    public SourceDefinition withScript(SourceScript script) {
        List<SourceScript> next = scripts == null ? new java.util.ArrayList<>() : new java.util.ArrayList<>(scripts);
        next.add(script);
        return new SourceDefinition(typeSource, name, publicData, privateData, next);
    }
}
