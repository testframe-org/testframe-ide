package com.testframe.server.dto;

import java.util.Map;

/**
 * Single-card run ({@code POST /api/v2/run/card}): the same engine as the frame run, for the
 * card editor's Run button. {@code vars} are the variables the editor already has (the last
 * run's plus the JSON cards before this card); {@code payload} is the code of the nearest JSON
 * card before the card in the step (the body of a request card), when one exists;
 * {@code resultCard} is the first JSON card after it (var-name and body): a successful
 * request/mongo run publishes that variable and the editor rewrites the card from it.
 */
public record RunCardRequest(String project, Integer step, Card card, Map<String, Object> vars,
                             String payload, ResultCard resultCard) {

    /** The JSON result card that follows the executed card in the step, when one exists. */
    public record ResultCard(String varName, String code) {
    }
}
