package com.testframe.server.dto;

import java.util.List;

/**
 * Frames of a project. {@code files} paths are relative to {@code testframe/frames/}
 * ({@code {frame}/step-{n}/{var-file}.md}). Every frame directory present in the paths, plus
 * {@code frame} when given (so an empty frame can be saved), is replaced by what was sent.
 */
public record SaveFramesRequest(String project, String frame, List<FrameFile> files) {
}
