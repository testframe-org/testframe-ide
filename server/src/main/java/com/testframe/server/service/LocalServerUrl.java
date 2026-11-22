package com.testframe.server.service;

import org.springframework.boot.web.server.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

/**
 * The framework server's own base URL, captured when the web server starts. Relative
 * endpoint paths of request cards ({@code POST /api/v2/echo}) run against it: the runner
 * executes the in-test HTTP calls server-side.
 */
@Component
public class LocalServerUrl implements ApplicationListener<WebServerInitializedEvent> {

    private volatile String baseUrl;

    @Override
    public void onApplicationEvent(WebServerInitializedEvent event) {
        baseUrl = "http://localhost:" + event.getWebServer().getPort();
    }

    public String get() {
        return baseUrl;
    }
}
