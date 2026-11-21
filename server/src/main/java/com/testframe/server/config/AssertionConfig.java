package com.testframe.server.config;

import com.testframe.jsonata.JsonataAssertionService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AssertionConfig {

    @Bean
    public JsonataAssertionService jsonataAssertionService() {
        return new JsonataAssertionService();
    }
}
