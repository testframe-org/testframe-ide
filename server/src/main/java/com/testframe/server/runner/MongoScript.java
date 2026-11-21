package com.testframe.server.runner;

import org.bson.BsonArray;
import org.bson.BsonValue;

import java.util.ArrayList;
import java.util.List;

/**
 * A parsed mongo shell call: {@code db.<collection>.<operation>(<args>)} optionally chained with
 * {@code .sort(..)}, {@code .skip(n)}, {@code .limit(n)}. Arguments use the relaxed shell/extended
 * JSON syntax accepted by the BSON reader (unquoted keys, ObjectId(...), ISODate(...)).
 */
public record MongoScript(String collection, String operation, List<BsonValue> args, List<Call> chain) {

    public record Call(String name, List<BsonValue> args) {
    }

    public static MongoScript parse(String script) {
        Cursor c = new Cursor(stripComments(script).trim());
        c.expect("db");
        c.expect(".");
        String collection = c.identifier();
        c.expect(".");
        String operation = c.identifier();
        List<BsonValue> args = parseArgs(c.parenthesized());
        List<Call> chain = new ArrayList<>();
        while (c.peek('.')) {
            c.expect(".");
            String name = c.identifier();
            chain.add(new Call(name, parseArgs(c.parenthesized())));
        }
        c.skipSpaces();
        if (c.peek(';')) {
            c.pos++;
        }
        c.skipSpaces();
        if (!c.atEnd()) {
            throw new IllegalArgumentException("Unexpected text after the call at position " + c.pos);
        }
        return new MongoScript(collection, operation, args, chain);
    }

    private static List<BsonValue> parseArgs(String inner) {
        if (inner.isBlank()) {
            return List.of();
        }
        try {
            return BsonArray.parse("[" + inner + "]").getValues();
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Invalid arguments: " + e.getMessage(), e);
        }
    }

    /** Drops // line comments outside strings. */
    private static String stripComments(String text) {
        StringBuilder out = new StringBuilder();
        for (String line : text.split("\n", -1)) {
            boolean inString = false;
            char quote = 0;
            int cut = line.length();
            for (int i = 0; i < line.length(); i++) {
                char ch = line.charAt(i);
                if (inString) {
                    if (ch == '\\') {
                        i++;
                    } else if (ch == quote) {
                        inString = false;
                    }
                } else if (ch == '"' || ch == '\'') {
                    inString = true;
                    quote = ch;
                } else if (ch == '/' && i + 1 < line.length() && line.charAt(i + 1) == '/') {
                    cut = i;
                    break;
                }
            }
            out.append(line, 0, cut).append('\n');
        }
        return out.toString();
    }

    private static final class Cursor {
        private final String text;
        private int pos;

        Cursor(String text) {
            this.text = text;
        }

        boolean atEnd() {
            return pos >= text.length();
        }

        void skipSpaces() {
            while (!atEnd() && Character.isWhitespace(text.charAt(pos))) {
                pos++;
            }
        }

        boolean peek(char ch) {
            skipSpaces();
            return !atEnd() && text.charAt(pos) == ch;
        }

        void expect(String token) {
            skipSpaces();
            if (!text.startsWith(token, pos)) {
                throw new IllegalArgumentException("Expected '" + token + "' at position " + pos
                        + " (scripts look like db.<collection>.find({...}))");
            }
            pos += token.length();
        }

        String identifier() {
            skipSpaces();
            int start = pos;
            while (!atEnd() && (Character.isLetterOrDigit(text.charAt(pos)) || "_-$".indexOf(text.charAt(pos)) >= 0)) {
                pos++;
            }
            if (start == pos) {
                throw new IllegalArgumentException("Expected a name at position " + pos);
            }
            return text.substring(start, pos);
        }

        /** Returns the text between balanced parentheses (strings respected). */
        String parenthesized() {
            expect("(");
            int start = pos;
            int depth = 1;
            char quote = 0;
            while (!atEnd()) {
                char ch = text.charAt(pos);
                if (quote != 0) {
                    if (ch == '\\') {
                        pos++;
                    } else if (ch == quote) {
                        quote = 0;
                    }
                } else if (ch == '"' || ch == '\'') {
                    quote = ch;
                } else if (ch == '(') {
                    depth++;
                } else if (ch == ')' && --depth == 0) {
                    String inner = text.substring(start, pos);
                    pos++;
                    return inner;
                }
                pos++;
            }
            throw new IllegalArgumentException("Unbalanced parentheses");
        }
    }
}
