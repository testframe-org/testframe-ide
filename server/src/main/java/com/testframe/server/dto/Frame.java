package com.testframe.server.dto;

import java.util.List;

/** One flow: {@code frames/{name}/}. The name is stored as its slug. */
public record Frame(String name, List<Step> steps) {
}
