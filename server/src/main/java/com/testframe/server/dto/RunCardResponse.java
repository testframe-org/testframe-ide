package com.testframe.server.dto;

import java.util.Map;

/** Single-card run response: the card's result and the variables after it (input plus published). */
public record RunCardResponse(CardResult result, Map<String, Object> vars) {
}
