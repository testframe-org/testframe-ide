package com.testframe.server.format;

import java.util.List;

/** Data that cannot be stored in the project format (answered with HTTP 400). */
public class FormatException extends RuntimeException {

    private final List<String> issues;

    public FormatException(List<String> issues) {
        super(String.join("; ", issues));
        this.issues = List.copyOf(issues);
    }

    public FormatException(String issue) {
        this(List.of(issue));
    }

    public List<String> issues() {
        return issues;
    }
}
