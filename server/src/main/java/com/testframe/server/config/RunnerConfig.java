package com.testframe.server.config;

import com.testframe.server.runner.HttpRequestRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RunnerConfig {

    @Bean
    public HttpRequestRunner httpRequestRunner() {
        return new HttpRequestRunner();
    }
}
