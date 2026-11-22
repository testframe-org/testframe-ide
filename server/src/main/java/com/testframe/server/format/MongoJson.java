package com.testframe.server.format;

import java.util.ArrayList;
import java.util.List;

/**
 * The canonical text of a mongo card body (a JSON array of call arguments, possibly with
 * {@code {{bindings}}}): one argument per line, each printed compactly
 * ({@code { "a": 1, "b": [1, 2] }}), key order and every string, number and binding kept
 * verbatim. The user may type the array any way; the server stores this form, so a second save
 * of unchanged content is byte-identical.
 * <pre>
 *   [
 *     { "ativo": true },
 *     { "nome": 1 }
 *   ]
 * </pre>
 */
public final class MongoJson {

    private MongoJson() {
    }

    /** The canonical text, or {@code null} when the code is not a well-formed array (the rule reports why). */
    public static String format(String code) {
        if (code == null || code.isBlank()) {
            return "";
        }
        try {
            Reader r = new Reader(code);
            Object value = r.value();
            r.skip();
            if (!r.atEnd() || !(value instanceof Arr array)) {
                return null;
            }
            if (array.items().isEmpty()) {
                return "[]";
            }
            List<String> lines = new ArrayList<>();
            for (Object item : array.items()) {
                lines.add("  " + print(item));
            }
            return "[\n" + String.join(",\n", lines) + "\n]";
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private record Arr(List<Object> items) {
    }

    private record Obj(List<String> keys, List<Object> values) {
    }

    /** An atom kept as written: a string (with its quotes), number, literal or bare binding. */
    private record Atom(String text) {
    }

    private static String print(Object value) {
        if (value instanceof Atom atom) {
            return atom.text();
        }
        if (value instanceof Arr arr) {
            List<String> items = new ArrayList<>();
            arr.items().forEach(i -> items.add(print(i)));
            return "[" + String.join(", ", items) + "]";
        }
        Obj obj = (Obj) value;
        if (obj.keys().isEmpty()) {
            return "{}";
        }
        List<String> entries = new ArrayList<>();
        for (int i = 0; i < obj.keys().size(); i++) {
            entries.add(obj.keys().get(i) + ": " + print(obj.values().get(i)));
        }
        return "{ " + String.join(", ", entries) + " }";
    }

    private static final class Reader {
        private final String text;
        private int pos;

        Reader(String text) {
            this.text = text;
        }

        boolean atEnd() {
            return pos >= text.length();
        }

        void skip() {
            while (!atEnd() && Character.isWhitespace(text.charAt(pos))) {
                pos++;
            }
        }

        Object value() {
            skip();
            if (atEnd()) {
                throw new IllegalArgumentException("unexpected end");
            }
            char ch = text.charAt(pos);
            if (text.startsWith("{{", pos)) {
                int end = text.indexOf("}}", pos);
                if (end < 0) {
                    throw new IllegalArgumentException("unclosed binding");
                }
                String binding = text.substring(pos, end + 2);
                pos = end + 2;
                return new Atom(binding);
            }
            if (ch == '{') {
                pos++;
                List<String> keys = new ArrayList<>();
                List<Object> values = new ArrayList<>();
                skip();
                if (!atEnd() && text.charAt(pos) == '}') {
                    pos++;
                    return new Obj(keys, values);
                }
                while (true) {
                    skip();
                    if (atEnd() || text.charAt(pos) != '"') {
                        throw new IllegalArgumentException("expected a key");
                    }
                    keys.add(string());
                    skip();
                    expect(':');
                    values.add(value());
                    skip();
                    if (!atEnd() && text.charAt(pos) == ',') {
                        pos++;
                        continue;
                    }
                    expect('}');
                    return new Obj(keys, values);
                }
            }
            if (ch == '[') {
                pos++;
                List<Object> items = new ArrayList<>();
                skip();
                if (!atEnd() && text.charAt(pos) == ']') {
                    pos++;
                    return new Arr(items);
                }
                while (true) {
                    items.add(value());
                    skip();
                    if (!atEnd() && text.charAt(pos) == ',') {
                        pos++;
                        continue;
                    }
                    expect(']');
                    return new Arr(items);
                }
            }
            if (ch == '"') {
                return new Atom(string());
            }
            int start = pos;
            while (!atEnd() && "{}[],: \t\r\n".indexOf(text.charAt(pos)) < 0) {
                pos++;
            }
            if (start == pos) {
                throw new IllegalArgumentException("unexpected '" + ch + "'");
            }
            return new Atom(text.substring(start, pos));
        }

        /** A quoted string, returned with its quotes exactly as written. */
        String string() {
            int start = pos;
            pos++;
            while (!atEnd()) {
                char ch = text.charAt(pos);
                if (ch == '\\') {
                    pos += 2;
                    continue;
                }
                if (ch == '\n') {
                    throw new IllegalArgumentException("line break inside a string");
                }
                pos++;
                if (ch == '"') {
                    return text.substring(start, pos);
                }
            }
            throw new IllegalArgumentException("unterminated string");
        }

        void expect(char ch) {
            skip();
            if (atEnd() || text.charAt(pos) != ch) {
                throw new IllegalArgumentException("expected '" + ch + "'");
            }
            pos++;
        }
    }
}
