package com.testframe.server.format;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardRun;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
import com.testframe.server.dto.Step;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A frame directory: {@code {frame}/step-{n}/{var-file}.md} cards, the per-step
 * {@code flow.md} that maps the card sequence, plus the private and last-run siblings.
 */
public final class FrameCodec {

    /** Name of the per-step sequence file: lists the card file names in execution order. */
    public static final String FLOW_FILE = "flow.md";

    private static final Pattern CARD_PATH = Pattern.compile("([a-z0-9][a-z0-9-]*)/step-(\\d{1,9})/([a-z0-9][a-z0-9-]*)\\.md");
    private static final Pattern PRIVATE_PATH = Pattern.compile("([a-z0-9][a-z0-9-]*/step-\\d+/[a-z0-9][a-z0-9-]*)\\.private(\\.example)?\\.md");
    private static final Pattern RESULT_PATH = Pattern.compile("([a-z0-9][a-z0-9-]*/step-\\d+/[a-z0-9][a-z0-9-]*)\\.result-data\\.md");
    private static final Pattern FLOW_PATH = Pattern.compile("([a-z0-9][a-z0-9-]*)/step-(\\d{1,9})/" + FLOW_FILE);

    /** Files of one frame directory ({@code dir} = slug of the frame name). */
    public record Written(String dir, List<ProjectFile> files) {
    }

    /** One card file of a step, with its file base name (the key in {@code flow.md}). */
    private record Entry(String fileBase, Card card) {
    }

    private FrameCodec() {
    }

    /** Directory of a frame name. */
    public static String dirOf(String frameName) {
        return Names.slug(frameName);
    }

    /** {@code {frame}/step-{n}/{var-file}} (no extension) of a card. */
    public static String cardBase(String frameName, int stepNumber, String varName) {
        return "%s/step-%d/%s".formatted(dirOf(frameName), stepNumber, Names.varNameToFileName(varName));
    }

    /** Var-name of a card: its own, or derived from its title. */
    public static String varNameOf(Card card) {
        return card.varName() == null || card.varName().isEmpty() ? Names.toVarName(card.title()) : card.varName();
    }

    /**
     * Serializes one frame. Steps are numbered by position and each step gets a
     * {@code flow.md} listing its card files in order. Throws when a var-name cannot be
     * stored (duplicate in the frame, lost by the kebab-case file name, or {@code flow}, the
     * reserved sequence file) or when a card's frontmatter would not load back.
     */
    public static Written write(Frame frame, ScriptLookup scripts) {
        String dir = dirOf(frame.name());
        List<String> issues = new ArrayList<>();
        Map<String, String> seen = new LinkedHashMap<>();
        List<ProjectFile> files = new ArrayList<>();
        List<Step> steps = frame.steps() == null ? List.of() : frame.steps();
        for (int s = 0; s < steps.size(); s++) {
            List<Card> cards = steps.get(s).cards() == null ? List.of() : steps.get(s).cards();
            List<String> flow = new ArrayList<>();
            List<ProjectFile> stepFiles = new ArrayList<>();
            for (Card card : cards) {
                String varName = varNameOf(card);
                String where = "step %d \"%s\"".formatted(s + 1, card.title());
                if (!Names.isRoundTrip(varName)) {
                    issues.add("var-name \"%s\" cannot be stored; use \"%s\"".formatted(varName, Names.normalizeVarName(varName)));
                    continue;
                }
                String fileBase = Names.varNameToFileName(varName);
                if (fileBase.equals("flow")) {
                    issues.add("var-name \"flow\" is reserved by the step sequence file; use another name");
                    continue;
                }
                if (seen.containsKey(varName)) {
                    issues.add("var-name \"%s\" is used twice (%s and %s)".formatted(varName, seen.get(varName), where));
                    continue;
                }
                seen.put(varName, where);
                Optional<String> script = card.script() == null || card.script().isEmpty()
                        ? Optional.empty()
                        : scripts.body(card.sourceType(), card.sourceName(), card.script());
                String content = CardCodec.render(card.withVarName(varName), script);
                List<String> problems = CardCodec.validate(MdEnvelope.parse(content).fields());
                String codeProblem = CodeRules.problem(card.sourceType(), card.code());
                if (codeProblem != null) {
                    problems.add("code: " + codeProblem);
                }
                if (!problems.isEmpty()) {
                    problems.forEach(p -> issues.add(where + ": " + p));
                    continue;
                }
                String base = "%s/step-%d/%s".formatted(dir, s + 1, fileBase);
                stepFiles.add(new ProjectFile(base + CardCodec.CARD_SUFFIX, content));
                if (!Names.isBlank(card.privateData())) {
                    stepFiles.add(new ProjectFile(base + CardCodec.PRIVATE_SUFFIX, CardCodec.renderPrivate(card.privateData())));
                }
                flow.add(fileBase);
            }
            if (!flow.isEmpty()) {
                files.add(new ProjectFile("%s/step-%d/%s".formatted(dir, s + 1, FLOW_FILE),
                        MdEnvelope.render(String.join("\n", flow))));
            }
            files.addAll(stepFiles);
        }
        if (!issues.isEmpty()) {
            throw new FormatException(issues);
        }
        return new Written(dir, files);
    }

    /**
     * Groups the files under {@code frames/} into frames and steps. Each step's {@code flow.md}
     * gives the card sequence; cards it does not list are appended (file-name order) and
     * reported. Invalid files are reported in {@code errors} and skipped; a real
     * {@code .private.md} wins over its {@code .private.example.md}.
     */
    public static FramesResponse read(List<ProjectFile> files, ScriptLookup scripts) {
        record Private(String body, boolean example) {
        }
        List<String> errors = new ArrayList<>();
        Map<String, Private> privates = new LinkedHashMap<>();
        Map<String, CardRun> results = new LinkedHashMap<>();
        Map<String, List<String>> flows = new LinkedHashMap<>();
        List<ProjectFile> cardFiles = new ArrayList<>();
        for (ProjectFile file : files) {
            Matcher f = RESULT_PATH.matcher(file.path());
            if (f.matches()) {
                results.put(f.group(1), CardCodec.parseResult(file.content()));
                continue;
            }
            Matcher fl = FLOW_PATH.matcher(file.path());
            if (fl.matches()) {
                flows.put("%s/step-%s".formatted(fl.group(1), fl.group(2)), flowEntries(file));
                continue;
            }
            Matcher m = PRIVATE_PATH.matcher(file.path());
            if (!m.matches()) {
                cardFiles.add(file);
                continue;
            }
            boolean example = m.group(2) != null;
            Private current = privates.get(m.group(1));
            if (current == null || (current.example() && !example)) {
                privates.put(m.group(1), new Private(CardCodec.parsePrivate(file.content()), example));
            }
        }

        Map<String, TreeMap<Integer, List<Entry>>> byFrame = new TreeMap<>();
        Set<String> claimed = new HashSet<>();
        for (ProjectFile file : cardFiles) {
            Matcher m = CARD_PATH.matcher(file.path());
            if (!m.matches()) {
                errors.add(file.path() + ": path must be {frame}/step-{n}/{var-name}.md");
                continue;
            }
            CardCodec.Parsed parsed = CardCodec.parse(m.group(3), file.content(), scripts);
            if (!parsed.errors().isEmpty()) {
                errors.add(file.path() + ": " + String.join("; ", parsed.errors()));
                continue;
            }
            parsed.warnings().forEach(w -> errors.add(file.path() + ": " + w));
            String base = file.path().substring(0, file.path().length() - CardCodec.CARD_SUFFIX.length());
            Private priv = privates.get(base);
            if (priv != null) {
                claimed.add(base);
            }
            Card card = parsed.card()
                    .withPrivateData(priv == null ? null : priv.body())
                    .withLastRun(results.get(base));
            byFrame.computeIfAbsent(m.group(1), k -> new TreeMap<>())
                    .computeIfAbsent(Integer.parseInt(m.group(2)), k -> new ArrayList<>())
                    .add(new Entry(m.group(3), card));
        }
        for (String base : privates.keySet()) {
            if (!claimed.contains(base)) {
                errors.add("%s: private data without a card (%s.md missing)".formatted(base, base));
            }
        }

        List<Frame> frames = new ArrayList<>();
        byFrame.forEach((name, stepsByNumber) -> {
            List<Step> steps = new ArrayList<>();
            stepsByNumber.forEach((number, entries) -> {
                List<Entry> ordered = orderStep(name, number, entries, flows.get("%s/step-%s".formatted(name, number)), errors);
                steps.add(new Step(steps.size() + 1, ordered.stream().map(Entry::card).toList()));
            });
            frames.add(new Frame(name, steps));
        });
        return new FramesResponse(frames, errors);
    }

    /** The card file names listed in a {@code flow.md} body, in order. */
    private static List<String> flowEntries(ProjectFile file) {
        List<String> entries = new ArrayList<>();
        for (String line : MdEnvelope.parse(file.content()).body().split("\\R")) {
            String name = line.trim();
            if (name.endsWith(".md")) {
                name = name.substring(0, name.length() - 3);
            }
            if (!name.isEmpty()) {
                entries.add(name);
            }
        }
        return entries;
    }

    /** Sorts a step's cards by its {@code flow.md}, reporting mismatches. */
    private static List<Entry> orderStep(String frame, int step, List<Entry> entries, List<String> flow, List<String> errors) {
        if (flow == null) {
            return entries.stream().sorted(Comparator.comparing(Entry::fileBase)).toList();
        }
        Map<String, Entry> byBase = new HashMap<>();
        entries.forEach(e -> byBase.put(e.fileBase(), e));
        List<Entry> ordered = new ArrayList<>();
        Set<String> listed = new HashSet<>();
        for (String name : flow) {
            Entry entry = byBase.get(name);
            if (entry == null) {
                errors.add("%s/step-%d/%s: %s.md is listed but the card file is missing".formatted(frame, step, FLOW_FILE, name));
                continue;
            }
            if (!listed.add(name)) {
                errors.add("%s/step-%d/%s: %s.md is listed twice".formatted(frame, step, FLOW_FILE, name));
                continue;
            }
            ordered.add(entry);
        }
        entries.stream()
                .filter(e -> !listed.contains(e.fileBase()))
                .sorted(Comparator.comparing(Entry::fileBase))
                .forEach(e -> {
                    errors.add("%s/step-%d/%s.md: not listed in %s".formatted(frame, step, e.fileBase(), FLOW_FILE));
                    ordered.add(e);
                });
        return ordered;
    }
}
