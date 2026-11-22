package com.testframe.server.dto;

import java.util.List;

/** Each sent source replaces its files and script folder; sources not sent are untouched. */
public record SaveSourcesRequest(String project, List<Source> sources) {
}
