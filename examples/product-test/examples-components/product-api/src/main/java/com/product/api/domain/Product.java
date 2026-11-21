package com.product.api.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document(collection = "products")
public record Product(
        @Id String id,
        String nome,
        String categoria,
        double preco,
        boolean ativo
) {
}
