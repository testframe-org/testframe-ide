package com.testframe.server.dto;

import java.util.List;

public record SaveFramesRequest(String project, List<FrameFile> files) {
}
