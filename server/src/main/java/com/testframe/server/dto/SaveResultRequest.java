package com.testframe.server.dto;

/** Stores the last run of the card {@code varName} of {@code frames/{frame}/step-{step}/}. */
public record SaveResultRequest(String project, String frame, Integer step, String varName, CardRun result) {
}
