package com.testframe.server.dto;

import java.util.List;

/**
 * Whole-frame run ({@code POST /api/v2/run}): the editor sends the frame it shows (unsaved
 * edits included) and the server executes it. Steps run in the sent order, cards in the
 * step's array order, and the run stops at the first error card. Only the project, the
 * frame name and the card data matter; sizes, ids and last runs are ignored.
 */
public record RunFrameRequest(String project, String frame, List<Step> steps) {
}
