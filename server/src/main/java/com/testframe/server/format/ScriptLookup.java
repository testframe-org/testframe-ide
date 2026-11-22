package com.testframe.server.format;

import com.testframe.server.dto.Source;
import com.testframe.server.dto.SourceScript;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

/** Finds the body of a source script ({@code sources/{type}/{name}/{script-file}.md}). */
@FunctionalInterface
public interface ScriptLookup {

    Optional<String> body(String sourceType, String sourceName, String script);

    ScriptLookup NONE = (type, name, script) -> Optional.empty();

    static ScriptLookup of(List<Source> sources) {
        return (type, name, script) -> sources.stream()
                .filter(s -> Objects.equals(s.typeSource(), type) && Objects.equals(s.name(), name))
                .findFirst()
                .flatMap(s -> (s.scripts() == null ? List.<SourceScript>of() : s.scripts()).stream()
                        .filter(x -> Objects.equals(x.name(), script))
                        .findFirst())
                .map(x -> x.body() == null ? "" : x.body());
    }
}
