package com.testframe.server.dto;

/** Replaces {@code frames/{slug(frame.name)}/} with the given frame. Other frames are untouched. */
public record SaveFrameRequest(String project, Frame frame) {
}
