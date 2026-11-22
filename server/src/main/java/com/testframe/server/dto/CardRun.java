package com.testframe.server.dto;

/** Last run of a card ({@code {var-file}.cache.md}): status idle|success|error|skipped. */
public record CardRun(String status, String text, String output, String at, String ranAt) {
}
