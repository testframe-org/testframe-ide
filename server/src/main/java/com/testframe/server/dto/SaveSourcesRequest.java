package com.testframe.server.dto;

import java.util.List;

/** Each sent source replaces its files; sources not sent are untouched. */
public record SaveSourcesRequest(String project, List<Source> sources) {
}
