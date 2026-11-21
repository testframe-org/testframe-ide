package com.testframe.server.config;

import io.github.jsonassert.JsonataAssertionService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AssertionConfig {

    @Bean
    public JsonataAssertionService jsonataAssertionService() {
        return new JsonataAssertionService();
    }
}
