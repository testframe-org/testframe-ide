package com.testframe.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// No implicit Mongo client: connections come only from the edited project's source files
// (sources/mongo/{name}.md base-url), see runner/MongoRunner.
@SpringBootApplication(excludeName = {
		"org.springframework.boot.mongodb.autoconfigure.MongoAutoConfiguration",
		"org.springframework.boot.mongodb.autoconfigure.MongoReactiveAutoConfiguration",
		"org.springframework.boot.mongodb.autoconfigure.health.MongoHealthContributorAutoConfiguration",
		"org.springframework.boot.mongodb.autoconfigure.health.MongoReactiveHealthContributorAutoConfiguration",
		"org.springframework.boot.mongodb.autoconfigure.metrics.MongoMetricsAutoConfiguration",
		"org.springframework.boot.data.mongodb.autoconfigure.DataMongoAutoConfiguration",
		"org.springframework.boot.data.mongodb.autoconfigure.DataMongoReactiveAutoConfiguration",
		"org.springframework.boot.data.mongodb.autoconfigure.DataMongoRepositoriesAutoConfiguration",
		"org.springframework.boot.data.mongodb.autoconfigure.DataMongoReactiveRepositoriesAutoConfiguration"
})
public class ServerApplication {

	public static void main(String[] args) {
		SpringApplication.run(ServerApplication.class, args);
	}

}
