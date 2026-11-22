package com.testframe.server.dto;

/**
 * One card of a frame as exchanged with the editor. Identity on disk is
 * {@code frames/{frame}/step-{n}/{var-file}.md} and the card's place in the step comes from
 * {@code flow.md}; {@code type} and {@code httpMethod} are derived (from the source type and
 * the endpoint) and ignored on save, as is {@code lastRun}. Null
 * {@code timeout}/{@code width}/{@code height} mean the defaults of the card type.
 */
public record Card(
        String varName,
        String title,
        String type,
        String sourceType,
        String sourceName,
        String script,
        String endpoint,
        String httpMethod,
        Integer timeout,
        Integer width,
        Integer height,
        Integer resultHeight,
        String code,
        String privateData,
        CardRun lastRun
) {

    public Card withVarName(String name) {
        return new Card(name, title, type, sourceType, sourceName, script, endpoint, httpMethod,
                timeout, width, height, resultHeight, code, privateData, lastRun);
    }

    public Card withStored(String privateData, CardRun lastRun) {
        return new Card(varName, title, type, sourceType, sourceName, script, endpoint, httpMethod,
                timeout, width, height, resultHeight, code, privateData, lastRun);
    }
}
