package com.testframe.server.dto;

/** A custom query/method of a source: camelCase {@code name}, stored as {@code {kebab-name}.md}. */
public record SourceScript(String name, String body) {
}
