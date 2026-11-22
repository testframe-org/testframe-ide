package com.testframe.server.controller;

import com.testframe.server.dto.FramesResponse;
import com.testframe.server.dto.SaveFrameRequest;
import com.testframe.server.dto.SaveResultRequest;
import com.testframe.server.service.FrameService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/v2/frames")
public class FrameController {

    private final FrameService frames;

    public FrameController(FrameService frames) {
        this.frames = frames;
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody SaveFrameRequest request) throws IOException {
        return frames.save(request.project(), request.frame());
    }

    @PostMapping("/results")
    public Map<String, Object> saveResult(@RequestBody SaveResultRequest request) throws IOException {
        return frames.saveResult(request.project(), request.frame(), request.step(), request.varName(), request.result());
    }

    @GetMapping("/{project}")
    public FramesResponse load(@PathVariable String project) throws IOException {
        return frames.load(project);
    }
}
