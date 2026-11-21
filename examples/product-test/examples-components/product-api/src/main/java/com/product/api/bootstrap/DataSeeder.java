package com.product.api.bootstrap;

import com.product.api.domain.Product;
import com.product.api.repository.ProductRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class DataSeeder implements CommandLineRunner {

    private final ProductRepository repository;

    public DataSeeder(ProductRepository repository) {
        this.repository = repository;
    }

    @Override
    public void run(String... args) {
        if (repository.count() > 0) {
            return;
        }
        repository.save(new Product(null, "Kit Testes E2E", "Ferramentas", 480.00, true));
        repository.save(new Product(null, "Licença TestFrame", "Software", 1290.00, true));
        repository.save(new Product(null, "Mouse Legacy", "Periféricos", 59.90, false));
    }
}
