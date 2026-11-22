package com.testframe.server.controller;

import com.testframe.server.format.Catalog;
import com.testframe.server.format.CodeRules;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Domain definitions served to clients (the editor keeps no local copies): the catalog of
 * source types with their card type, fence language and defaults, and the per-source-type
 * code rules ({@code POST /api/v2/validate}, enforced on frame and source saves).
 */
@RestController
@RequestMapping("/api/v2")
public class DomainController {

    public record SourceTypeEntry(String name, String cardType, String language, boolean hasScripts,
                                  int defaultWidth, int defaultHeight, int defaultTimeout) {
    }

    public record CatalogResponse(List<SourceTypeEntry> sourceTypes, List<String> httpMethods,
                                  List<String> mongoOps) {
    }

    public record ValidateRequest(String sourceType, String code) {
    }

    public record ValidateResponse(String problem) {
    }

    @GetMapping("/catalog")
    public CatalogResponse catalog() {
        List<SourceTypeEntry> entries = Catalog.SOURCE_TYPES.stream().map(type -> {
            String cardType = Catalog.cardTypeOf(type);
            Catalog.Size size = Catalog.defaultSize(cardType);
            return new SourceTypeEntry(type, cardType, Catalog.languageOf(type), Catalog.hasScripts(type),
                    size.width(), size.height(), Catalog.defaultTimeout(cardType));
        }).toList();
        return new CatalogResponse(entries, Catalog.HTTP_METHODS, CodeRules.MONGO_OPS);
    }

    /** The code rule of a source type: {@code problem} is null when the code is acceptable. */
    @PostMapping("/validate")
    public ValidateResponse validate(@RequestBody ValidateRequest request) {
        return new ValidateResponse(CodeRules.problem(request.sourceType(), request.code()));
    }
}
