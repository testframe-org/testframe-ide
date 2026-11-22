package com.testframe.server.format;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Code rules per source type (spec: docs/project-format.md). The editor asks the server
 * ({@code POST /api/v2/validate}) and both saves enforce them: frame cards and source scripts.
 * Empty code is a draft and always acceptable; types without a rule accept anything.
 */
public final class CodeRules {

    public static final List<String> MONGO_OPS = List.of("find", "findOne", "aggregate", "countDocuments", "distinct");

    private static final Pattern MONGO_CALL = Pattern.compile("^db\\.[A-Za-z_$][\\w$-]*\\.([A-Za-z]+)\\s*\\(");
    private static final Pattern ASSERT_LINE = Pattern.compile("^assert\\s+.+\\s(==|!=|>=|<=|>|<)\\s.+$");
    private static final Pattern SQL_STATEMENT = Pattern.compile("^select\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern SQL_STRING = Pattern.compile("'(?:''|[^'])*'");
    private static final Pattern JS_STRING = Pattern.compile("\"(?:\\\\.|[^\"])*\"|'(?:\\\\.|[^'])*'");

    private CodeRules() {
    }

    /** The problem with {@code code} for {@code sourceType}, or {@code null} when acceptable. */
    public static String problem(String sourceType, String code) {
        String text = code == null ? "" : code;
        return switch (sourceType == null ? "" : sourceType) {
            case "mongo" -> mongoProblem(stripLineComments(text, "//"));
            case "oracle" -> sqlProblem(stripLineComments(text, "--"));
            case "assert" -> assertProblem(text);
            default -> null;
        };
    }

    private static String mongoProblem(String body) {
        if (body.isEmpty()) {
            return null;
        }
        Matcher m = MONGO_CALL.matcher(body);
        if (!m.lookingAt()) {
            return "mongo cards accept one mongo shell call, e.g. db.products.find({ ativo: true })";
        }
        String op = m.group(1);
        if (!MONGO_OPS.contains(op)) {
            return "mongo operation \"" + op + "\" is not allowed (" + String.join(", ", MONGO_OPS) + ")";
        }
        if (!balanced(body)) {
            return "unbalanced brackets or quotes";
        }
        String tail = body.replaceAll(";\\s*$", "");
        if (!tail.endsWith(")")) {
            return "the mongo call must end with \")\"";
        }
        if (JS_STRING.matcher(tail).replaceAll("").contains(";")) {
            return "only one mongo call is allowed";
        }
        return null;
    }

    private static String sqlProblem(String body) {
        if (body.isEmpty()) {
            return null;
        }
        if (!SQL_STATEMENT.matcher(body).find()) {
            return "oracle cards accept a single SELECT statement";
        }
        String statement = body.replaceAll(";\\s*$", "");
        if (SQL_STRING.matcher(statement).replaceAll("").contains(";")) {
            return "only one SELECT statement is allowed";
        }
        return null;
    }

    private static String assertProblem(String code) {
        for (String line : code.split("\n", -1)) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty() && !trimmed.startsWith("//") && !ASSERT_LINE.matcher(trimmed).matches()) {
                return "not a jsonassert line: " + trimmed;
            }
        }
        return null;
    }

    private static String stripLineComments(String code, String marker) {
        List<String> kept = new ArrayList<>();
        for (String line : code.split("\n", -1)) {
            if (!line.trim().startsWith(marker)) {
                kept.add(line);
            }
        }
        return String.join("\n", kept).trim();
    }

    /** Parentheses/brackets/braces balanced outside quotes (the editor's live check). */
    private static boolean balanced(String text) {
        int depth = 0;
        char quote = 0;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (quote != 0) {
                if (ch == '\\') {
                    i++;
                } else if (ch == quote) {
                    quote = 0;
                }
            } else if (ch == '"' || ch == '\'') {
                quote = ch;
            } else if (ch == '(' || ch == '[' || ch == '{') {
                depth++;
            } else if (ch == ')' || ch == ']' || ch == '}') {
                if (--depth < 0) {
                    return false;
                }
            }
        }
        return depth == 0 && quote == 0;
    }
}
