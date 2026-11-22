package com.testframe.server.dto;

import lombok.With;

/**
 * Outcome of executing one card ({@code POST /api/v2/run}, {@code POST /api/v2/run/card}):
 * {@code status} is success|error, {@code text} the one-line log, {@code output} the payload
 * (response body, query result, assertion result or failure reason), {@code at} the elapsed
 * time since the run started and {@code ranAt} the ISO instant. {@code code} is set only when
 * the run rewrote the card body (the JSON result card that received the response): the editor
 * mirrors it into its model so the next save persists it.
 */
@With
public record CardResult(String varName, String status, String text, String output, String at, String ranAt, String code) {
}
