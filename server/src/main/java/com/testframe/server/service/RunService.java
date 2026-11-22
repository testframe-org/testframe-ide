package com.testframe.server.service;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardResult;
import com.testframe.server.dto.FrameRunResponse;
import com.testframe.server.dto.RunCardRequest;
import com.testframe.server.dto.RunCardResponse;
import com.testframe.server.dto.RunFrameRequest;
import com.testframe.server.dto.Step;
import com.testframe.server.format.Catalog;
import com.testframe.server.format.CodeRules;
import com.testframe.server.format.Names;
import com.testframe.server.runner.Bindings;
import com.testframe.server.runner.HttpRequestRunner;
import com.testframe.server.runner.MongoScriptRunner;
import io.github.jsonassert.AssertionResult;
import io.github.jsonassert.JsonataAssertionService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.function.BiConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Server-side card runner (service layer phase 3): executes cards the way the editor's
 * {@code executeCard} did — {@code {{bindings}}}, in-flow HTTP requests (via
 * {@link HttpRequestRunner}, so no browser CORS applies), mongo scripts (reusing
 * {@link MongoScriptRunner}) and jsonassert validations (the Java engine) — publishing one
 * variable per card and stopping at the first error card. The editor keeps only its
 * optimistic UI state and the result persistence.
 */
@Service
public class RunService {

    private static final Pattern ENDPOINT = Pattern.compile("^(GET|POST|PUT|PATCH|DELETE)\\s+(\\S+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern ASSERT_HEAD = Pattern.compile("^assert\\b", Pattern.CASE_INSENSITIVE);
    private static final String SIMULATED = "Simulated: this source type is not executed live yet.";

    private static final TypeReference<Object> ANY = new TypeReference<>() {
    };
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {
    };

    private final MongoScriptRunner mongo;
    private final SourceService sources;
    private final JsonataAssertionService assertions;
    private final HttpRequestRunner http;
    private final ObjectMapper json;

    public RunService(MongoScriptRunner mongo, SourceService sources, JsonataAssertionService assertions,
                      HttpRequestRunner http, ObjectMapper json) {
        this.mongo = mongo;
        this.sources = sources;
        this.assertions = assertions;
        this.http = http;
        this.json = json;
    }

    /**
     * Runs a whole frame: steps in the sent order, cards in the step's array order (the
     * editor's flow order), stopping at the first error card. A request body comes from the
     * nearest JSON card before the card, and a request or mongo success is also written into
     * the first JSON card after it and published as that card's variable; the rewritten card
     * comes back with its new body in the result's {@code code}, so the editor mirrors it.
     */
    public FrameRunResponse runFrame(RunFrameRequest request, String serverBaseUrl) {
        requireProject(request.project());
        Map<String, Object> vars = new LinkedHashMap<>();
        List<CardResult> results = new ArrayList<>();
        long started = System.nanoTime();
        if (request.steps() != null) {
            for (Step step : request.steps()) {
                if (step.cards() == null) {
                    continue;
                }
                // Working copy: the JSON result card receives the run's payload as its body
                List<Card> cards = new ArrayList<>(step.cards());
                List<String> sentCode = cards.stream().map(RunService::code).toList();
                for (int i = 0; i < cards.size(); i++) {
                    // The step's JSON cards around this card (both searched in this step only)
                    String payloadCode = null;
                    for (int p = i - 1; p >= 0; p--) {
                        if (isJsonCard(cards.get(p))) {
                            payloadCode = code(cards.get(p));
                            break;
                        }
                    }
                    int resultIndex = -1;
                    for (int q = i + 1; q < cards.size(); q++) {
                        if (isJsonCard(cards.get(q))) {
                            resultIndex = q;
                            break;
                        }
                    }
                    final int target = resultIndex;
                    CardResult result = execute(cards.get(i), step.number(), payloadCode,
                            target >= 0 ? code(cards.get(target)) : null,
                            (value, pretty) -> {
                                if (target >= 0) {
                                    Card resultCard = cards.get(target);
                                    cards.set(target, resultCard.withCode(pretty));
                                    vars.put(varNameOf(resultCard), value);
                                }
                            }, vars, request.project(), serverBaseUrl, started);
                    if (!Objects.equals(code(cards.get(i)), sentCode.get(i))) {
                        result = result.withCode(code(cards.get(i)));
                    }
                    results.add(result);
                    if ("error".equals(result.status())) {
                        return new FrameRunResponse(request.project(), request.frame(), results, vars);
                    }
                }
            }
        }
        return new FrameRunResponse(request.project(), request.frame(), results, vars);
    }

    /** Runs one card (the editor's Run button) with the variables the editor already has. */
    public RunCardResponse runCard(RunCardRequest request, String serverBaseUrl) {
        requireProject(request.project());
        if (request.card() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "card is required");
        }
        Map<String, Object> vars = request.vars() == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(request.vars());
        long started = System.nanoTime();
        RunCardRequest.ResultCard resultCard = request.resultCard();
        String resultVarName = resultCard == null ? "" : Names.trim(resultCard.varName());
        // The result card itself is not sent (only its var-name and body): a successful run
        // publishes its variable and the editor rewrites the card from it
        BiConsumer<Object, String> writeToResultCard = (value, pretty) -> {
            if (!resultVarName.isEmpty()) {
                vars.put(resultVarName, value);
            }
        };
        CardResult result = execute(request.card(), request.step(),
                request.payload(), resultCard == null ? null : resultCard.code(),
                writeToResultCard, vars, request.project(), serverBaseUrl, started);
        return new RunCardResponse(result, vars);
    }

    // ------------------------------------------------------------------ engine

    /**
     * Executes one card and publishes its variable into {@code vars}. {@code payloadCode} is
     * the body of the nearest JSON card before it (the request card's body), {@code
     * simulatedResultCode} the body of the first JSON card after it (read by simulated
     * js/sql/jsonassert cards), and {@code writeToResultCard} receives successful request and
     * mongo runs so the result card is fed with the payload.
     */
    private CardResult execute(Card card, Integer stepNumber, String payloadCode, String simulatedResultCode,
                               BiConsumer<Object, String> writeToResultCard, Map<String, Object> vars,
                               String project, String serverBaseUrl, long started) {
        String varName = varNameOf(card);
        String title = Names.isBlank(card.title()) ? varName : Names.trim(card.title());
        String stepLabel = "[Step " + (stepNumber == null ? 1 : stepNumber) + "] ";
        String code = code(card);
        String sourceType = card.sourceType() == null ? "" : card.sourceType();
        String type = Catalog.cardTypeOf(sourceType);
        long timeout = Math.clamp(card.timeout() == null ? Catalog.defaultTimeout(type) : card.timeout(),
                100, 120_000);
        // Forced failure only through an explicit marker in the code (kept from the editor)
        boolean shouldFail = code.toLowerCase(Locale.ROOT).contains("force_fail")
                || code.toLowerCase(Locale.ROOT).contains("expect(false).tobe(true)");

        // Code rules per source type (format/CodeRules): an invalid card never runs
        String problem = CodeRules.problem(sourceType, code);
        if (problem != null) {
            return result(varName, "error", stepLabel + title + ": " + sourceType + " " + problem, problem, started);
        }

        if ("validation".equals(type) && ASSERT_HEAD.matcher(code.trim()).find()) {
            return runAssertion(varName, stepLabel, title, code, shouldFail, vars, started);
        }
        if ("request".equals(type)) {
            String[] parts = endpointParts(card);
            if (parts != null) {
                return runRequest(varName, stepLabel, title, parts, payloadCode, timeout, writeToResultCard,
                        shouldFail, vars, serverBaseUrl, started);
            }
            // No endpoint on a request card: nothing to execute, the card stays simulated
        } else if ("mongo".equals(sourceType)) {
            return runMongo(varName, stepLabel, title, card, code, timeout, writeToResultCard, shouldFail,
                    vars, project, started);
        }

        // JSON cards publish their (bound) body; simulated js/sql/jsonassert cards publish the
        // body of the JSON result card that follows them, like the editor did
        Object published = Bindings.NOT_FOUND;
        if (!shouldFail && "json".equals(type)) {
            try {
                published = Bindings.substitute(parse(code), vars, json);
            } catch (RuntimeException ignored) {
                // contains unresolved templates: keep without publishing
            }
        } else if (!shouldFail && List.of("js", "sql", "jsonassert").contains(type) && simulatedResultCode != null) {
            try {
                published = parse(simulatedResultCode);
            } catch (RuntimeException ignored) {
                // not parseable yet
            }
        }
        if (published != Bindings.NOT_FOUND) {
            vars.put(varName, published);
        }
        String output = published == Bindings.NOT_FOUND ? SIMULATED : pretty(published);
        return result(varName, shouldFail ? "error" : "success",
                stepLabel + title + ": " + (shouldFail ? "FAILED assertion" : "OK"), output, started);
    }

    /** The live assertion card: the Java engine over every variable published so far. */
    private CardResult runAssertion(String varName, String stepLabel, String title, String code,
                                    boolean shouldFail, Map<String, Object> vars, long started) {
        AssertionResult outcome;
        try {
            outcome = assertions.evaluate(code.trim(), new LinkedHashMap<>(vars));
        } catch (RuntimeException e) {
            // malformed expression or engine failure: the card reports the reason and stops the run
            String message = String.valueOf(e.getMessage());
            return result(varName, "error", stepLabel + title + ": assertion error: " + message, message, started);
        }
        Map<String, Object> published = new LinkedHashMap<>();
        published.put("passed", outcome.passed());
        published.put("actual", outcome.actual());
        published.put("expected", outcome.expected());
        published.put("operator", outcome.operator());
        published.put("jsonata", outcome.jsonata());
        published.put("error", outcome.error());
        vars.put(varName, published);
        String text = stepLabel + title + ": assert " + (outcome.passed() ? "OK" : "FAILED assertion")
                + " (" + json.writeValueAsString(outcome.actual()) + " " + outcome.operator() + " "
                + json.writeValueAsString(outcome.expected()) + ")";
        return result(varName, outcome.passed() && !shouldFail ? "success" : "error", text, pretty(published), started);
    }

    /** The request card: an HTTP call executed by the framework server (no browser CORS). */
    private CardResult runRequest(String varName, String stepLabel, String title, String[] parts, String payloadCode,
                                  long timeout, BiConsumer<Object, String> writeToResultCard, boolean shouldFail,
                                  Map<String, Object> vars, String serverBaseUrl, long started) {
        String bodyJson = null;
        if (payloadCode != null) {
            try {
                // The body is the payload card's JSON after resolving {{bindings}}
                bodyJson = json.writeValueAsString(Bindings.substitute(parse(payloadCode), vars, json));
            } catch (RuntimeException ignored) {
                bodyJson = null; // unparsable payload: the request runs without body
            }
        }
        HttpRequestRunner.Response res = http.run(parts[0],
                HttpRequestRunner.resolveUrl(serverBaseUrl, parts[1]), bodyJson, timeout);
        String text = stepLabel + title + ": " + (res.status() == 0 ? res.body() : "HTTP " + res.status())
                + " (" + res.ms() + "ms)";
        Object published;
        try {
            published = parse(res.body());
        } catch (RuntimeException ignored) {
            published = res.body(); // the response is not JSON: publish the raw text
        }
        if (res.ok()) {
            vars.put(varName, published);
            // The result card shows the payload as text when it is not JSON, pretty otherwise
            writeToResultCard.accept(published, published instanceof String s ? s : pretty(published));
        }
        return result(varName, res.ok() && !shouldFail ? "success" : "error", text, res.body(), started);
    }

    /** The mongo card: the saved read-only script, executed by the shared MongoScriptRunner. */
    private CardResult runMongo(String varName, String stepLabel, String title, Card card, String code, long timeout,
                                BiConsumer<Object, String> writeToResultCard, boolean shouldFail,
                                Map<String, Object> vars, String project, long started) {
        String script = Bindings.substituteToString(code, vars, json);
        if (Names.isBlank(card.sourceName())) {
            String message = "the card has no mongo source (its saved sources/mongo/{name}.md holds the base-url)";
            return result(varName, "error", stepLabel + title + ": mongo " + message, message, started);
        }
        long began = System.nanoTime();
        try {
            String uri = sources.baseUrl(project, "mongo", card.sourceName());
            Map<String, Object> envelope = json.readValue(mongo.run(uri, script, timeout), MAP);
            Object value = envelope.get("result");
            vars.put(varName, value);
            writeToResultCard.accept(value, pretty(value));
            String summary = envelope.get("collection") + "." + envelope.get("operation") + " → " + envelope.get("count");
            return result(varName, shouldFail ? "error" : "success",
                    stepLabel + title + ": mongo " + summary + " (" + elapsedMs(began) + "ms)",
                    pretty(value), started);
        } catch (ResponseStatusException e) {
            String message = e.getStatusCode().value() + " " + e.getReason();
            return result(varName, "error", stepLabel + title + ": mongo " + message + " (" + elapsedMs(began) + "ms)",
                    message, started);
        } catch (IOException e) {
            // the source file could not be read or the driver failed to deliver
            String message = e.getClass().getSimpleName() + ": " + e.getMessage();
            return result(varName, "error", stepLabel + title + ": mongo " + message + " (" + elapsedMs(began) + "ms)",
                    message, started);
        } catch (RuntimeException e) {
            // read-only rejection is an IllegalArgumentException; connection failures come from the driver
            String message = e.getMessage() == null ? e.getClass().getSimpleName()
                    : e.getClass().getSimpleName() + ": " + e.getMessage();
            return result(varName, "error", stepLabel + title + ": " + message + " (" + elapsedMs(began) + "ms)",
                    message, started);
        }
    }

    // ----------------------------------------------------------------- helpers

    private static void requireProject(String project) {
        if (Names.isBlank(project)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "project is required");
        }
    }

    /** The METHOD + path of a request card: {@code "METHOD /path"} in the endpoint, or httpMethod + path. */
    static String[] endpointParts(Card card) {
        String endpoint = Names.trim(card.endpoint());
        Matcher m = ENDPOINT.matcher(endpoint);
        if (m.matches()) {
            return new String[]{m.group(1).toUpperCase(Locale.ROOT), m.group(2)};
        }
        if (!Names.isBlank(card.httpMethod()) && endpoint.startsWith("/")) {
            return new String[]{Names.trim(card.httpMethod()).toUpperCase(Locale.ROOT), endpoint};
        }
        return null;
    }

    private static CardResult result(String varName, String status, String text, String output, long started) {
        return new CardResult(varName, status, text, output,
                String.format(Locale.ROOT, "%.2fs", (System.nanoTime() - started) / 1e9),
                Instant.now().toString(), null);
    }

    private static boolean isJsonCard(Card card) {
        return "json".equals(Catalog.cardTypeOf(card.sourceType() == null ? "" : card.sourceType()));
    }

    private static String varNameOf(Card card) {
        String varName = Names.trim(card.varName());
        return !varName.isEmpty() ? varName : Names.toVarName(card.title());
    }

    private static String code(Card card) {
        return card.code() == null ? "" : card.code();
    }

    private Object parse(String text) {
        if (Names.isBlank(text)) {
            // like JS JSON.parse(""): empty code is not JSON, and nothing is published
            throw new IllegalArgumentException("no JSON");
        }
        return json.readValue(text, ANY);
    }

    private String pretty(Object value) {
        return json.writerWithDefaultPrettyPrinter().writeValueAsString(value);
    }

    private static long elapsedMs(long startedNanos) {
        return Math.round((System.nanoTime() - startedNanos) / 1e6);
    }
}
