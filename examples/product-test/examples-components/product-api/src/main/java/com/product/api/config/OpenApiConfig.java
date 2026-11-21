package com.product.api.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI productApiOpenApi() {
        return new OpenAPI().info(new Info()
                .title("Product API")
                .version("v1")
                .description("Catálogo de produtos do exemplo product-test (Spring Boot 4 + MongoDB). "
                        + "Source restapi usado pelos frames do TestFrame.")
                .contact(new Contact().name("TestFrame Examples"))
                .license(new License().name("MIT")));
    }
}
