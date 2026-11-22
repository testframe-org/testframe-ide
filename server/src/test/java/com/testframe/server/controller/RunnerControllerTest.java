package com.testframe.server.controller;

import com.testframe.server.runner.HttpRequestRunner;
import com.testframe.server.runner.MongoScriptRunner;
import com.testframe.server.service.LocalServerUrl;
import com.testframe.server.service.RunService;
import com.testframe.server.service.SourceService;
import com.testframe.server.store.ProjectFileStore;
import io.github.jsonassert.JsonataAssertionService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The run endpoints' wiring and error shape ({@code {status, message}}). */
class RunnerControllerTest {

    @TempDir
    Path root;

    private MockMvc mvc() {
        SourceService sources = new SourceService(new ProjectFileStore(root.toString()));
        RunService runs = new RunService(new MongoScriptRunner(), sources, new JsonataAssertionService(),
                new HttpRequestRunner(), JsonMapper.builder().build());
        return MockMvcBuilders
                .standaloneSetup(new RunnerController(new MongoScriptRunner(), sources, runs, new LocalServerUrl()))
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void runsAFrameAndReturnsResultsAndVars() throws Exception {
        mvc().perform(post("/api/v2/run").contentType(MediaType.APPLICATION_JSON).content("""
                {"project": "demo", "frame": "flow", "steps": [{"number": 1, "cards": [
                  {"varName": "seed", "title": "Seed", "sourceType": "inline", "code": "{\\"n\\": 1}"},
                  {"varName": "copy", "title": "Copy", "sourceType": "inline", "code": "{\\"v\\": \\"{{seed.n}}\\"}"}]}]}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.frame").value("flow"))
                .andExpect(jsonPath("$.results.length()").value(2))
                .andExpect(jsonPath("$.results[0].varName").value("seed"))
                .andExpect(jsonPath("$.results[1].status").value("success"))
                .andExpect(jsonPath("$.results[1].text").value("[Step 1] Copy: OK"))
                .andExpect(jsonPath("$.vars.copy.v").value(1));
    }

    @Test
    void validatesTheRunRequests() throws Exception {
        mvc().perform(post("/api/v2/run").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"frame\": \"flow\", \"steps\": []}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.message").value("project is required"));

        mvc().perform(post("/api/v2/run/card").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"project\": \"demo\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("card is required"));
    }
}
