package com.product.api.controller;

import com.product.api.domain.Product;
import com.product.api.repository.ProductRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.CREATED;
import static org.springframework.http.HttpStatus.NOT_FOUND;

@RestController
@RequestMapping("/api/products")
@Tag(name = "Products", description = "CRUD do catálogo de produtos")
public class ProductController {

    private final ProductRepository repository;

    public ProductController(ProductRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    @Operation(summary = "Listar produtos", description = "Aceita filtros ?categoria= e ?ativos=true")
    public List<Product> list(@RequestParam(required = false) String categoria,
                              @RequestParam(required = false) Boolean ativos) {
        if (categoria != null && !categoria.isBlank()) {
            return repository.findByCategoriaIgnoreCase(categoria);
        }
        if (Boolean.TRUE.equals(ativos)) {
            return repository.findByAtivoTrue();
        }
        return repository.findAll();
    }

    @GetMapping("/{id}")
    @Operation(summary = "Buscar produto por id")
    public Product byId(@PathVariable String id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "produto não encontrado"));
    }

    @PostMapping
    @Operation(summary = "Criar produto")
    public ResponseEntity<Product> create(@RequestBody Product product) {
        if (product.nome() == null || product.nome().isBlank()) {
            throw new ResponseStatusException(BAD_REQUEST, "nome é obrigatório");
        }
        return ResponseEntity.status(CREATED).body(repository.save(product));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Excluir produto")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        if (!repository.existsById(id)) {
            throw new ResponseStatusException(NOT_FOUND, "produto não encontrado");
        }
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }
}
