package com.testframe.server.dto;

import java.util.List;

/** One step of a frame: cards in execution order. On save the number is the step's position (1-based). */
public record Step(Integer number, List<Card> cards) {
}
