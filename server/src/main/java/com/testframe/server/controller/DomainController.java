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
 * source types with their card subtypes (card type, fence language, form and
 * defaults per subtype), and the code rules per (type, subtype) ({@code POST /api/v2/validate},
 * enforced on frame and source saves).
 */
@RestController
@RequestMapping("/api/v2")
public class DomainController {

    /** One card kind of a type: {@code subtype} is null for types without subtypes. */
    public record CardKindEntry(String subtype, String cardType, String language, String form,
                                int defaultWidth, int defaultHeight, int defaultTimeout) {
    }

    /**
     * {@code hasSources}: cards name a source of the type (false for rawvalue and jsonassert);
     * {@code language}: the type's default fence language; {@code cards}: one entry per subtype.
     */
    public record SourceTypeEntry(String name, String language, boolean hasSources, List<String> subtypes,
                                  List<CardKindEntry> cards) {
    }

    public record CatalogResponse(List<SourceTypeEntry> sourceTypes, List<String> httpMethods) {
    }

    public record ValidateRequest(String sourceType, String subtype, String code) {
    }

    public record ValidateResponse(String problem) {
    }

    @GetMapping("/catalog")
    public CatalogResponse catalog() {
        List<SourceTypeEntry> entries = Catalog.TYPES.stream().map(type -> new SourceTypeEntry(
                type.name(), type.language(), type.hasSources(), type.subtypes(),
                type.kinds().stream().map(kind -> {
                    Catalog.Size size = Catalog.defaultSize(kind.cardType());
                    return new CardKindEntry(kind.subtype(), kind.cardType(), kind.language(), kind.form(), size.width(), size.height(), Catalog.defaultTimeout(kind.cardType()));
                }).toList())).toList();
        return new CatalogResponse(entries, Catalog.HTTP_METHODS);
    }

    /** The code rule of a (type, subtype): {@code problem} is null when the code is acceptable. */
    @PostMapping("/validate")
    public ValidateResponse validate(@RequestBody ValidateRequest request) {
        return new ValidateResponse(CodeRules.problem(request.sourceType(), request.subtype(), request.code()));
    }
}
