package com.testframe.server.dto;

import java.util.List;

/** Frames of a project plus the problems found while reading them (shown in the editor console). */
public record FramesResponse(List<Frame> frames, List<String> errors) {
}
