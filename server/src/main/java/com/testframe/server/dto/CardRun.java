package com.testframe.server.dto;

/** Last run of a card ({@code {var-file}.result-data.md}): status idle|success|error. */
public record CardRun(String status, String text, String output, String at, String ranAt) {
}
