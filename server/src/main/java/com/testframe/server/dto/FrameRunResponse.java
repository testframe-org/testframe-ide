package com.testframe.server.dto;

import java.util.List;
import java.util.Map;

/**
 * Whole-frame run response: one {@link CardResult} per executed card (in execution order;
 * the run stops at the first error) and the final variables map, so the editor can show the
 * bindings' values and persist every card result.
 */
public record FrameRunResponse(String project, String frame, List<CardResult> results, Map<String, Object> vars) {
}
