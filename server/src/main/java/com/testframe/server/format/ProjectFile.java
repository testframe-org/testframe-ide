package com.testframe.server.format;

/** One project file: {@code path} relative to {@code testframe/frames/} or {@code testframe/sources/}. */
public record ProjectFile(String path, String content) {
}
