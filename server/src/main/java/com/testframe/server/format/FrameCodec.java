package com.testframe.server.format;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardRun;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
import com.testframe.server.dto.Step;

import java.util.ArrayList;
import java.util.Comparator;
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
 * A frame directory: {@code {frame}/step-{n}/{var-file}.md} cards (paths relative to
 * {@code testframe/frames/}) plus their private and last-run siblings.
 */
public final class FrameCodec {

    private static final Pattern CARD_PATH = Pattern.compile("([a-z0-9][a-z0-9-]*)/step-(\\d{1,9})/([a-z0-9][a-z0-9-]*)\\.md");
    private static final Pattern PRIVATE_PATH = Pattern.compile("([a-z0-9][a-z0-9-]*/step-\\d+/[a-z0-9][a-z0-9-]*)\\.private(\\.example)?\\.md");
    private static final Pattern RESULT_PATH = Pattern.compile("([a-z0-9][a-z0-9-]*/step-\\d+/[a-z0-9][a-z0-9-]*)\\.result-data\\.md");

    /** Files of one frame directory ({@code dir} = slug of the frame name). */
    public record Written(String dir, List<ProjectFile> files) {
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
     * Serializes one frame. Steps and cards are numbered by position. Throws when a var-name
     * cannot be stored (duplicate in the frame, or lost by the kebab-case file name) or when a
     * card's frontmatter would not load back.
     */
    public static Written write(Frame frame, ScriptLookup scripts) {
        String dir = dirOf(frame.name());
        List<String> issues = new ArrayList<>();
        Map<String, String> seen = new LinkedHashMap<>();
        List<ProjectFile> files = new ArrayList<>();
        List<Step> steps = frame.steps() == null ? List.of() : frame.steps();
        for (int s = 0; s < steps.size(); s++) {
            List<Card> cards = steps.get(s).cards() == null ? List.of() : steps.get(s).cards();
            for (int c = 0; c < cards.size(); c++) {
                Card card = cards.get(c);
                String varName = varNameOf(card);
                String where = "step %d \"%s\"".formatted(s + 1, card.title());
                if (!Names.isRoundTrip(varName)) {
                    issues.add("var-name \"%s\" cannot be stored; use \"%s\"".formatted(varName, Names.normalizeVarName(varName)));
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
                String content = CardCodec.render(card.withVarName(varName), c + 1, script);
                List<String> problems = CardCodec.validate(MdEnvelope.parse(content).fields());
                if (!problems.isEmpty()) {
                    problems.forEach(p -> issues.add(where + ": " + p));
                    continue;
                }
                String base = "%s/step-%d/%s".formatted(dir, s + 1, Names.varNameToFileName(varName));
                files.add(new ProjectFile(base + CardCodec.CARD_SUFFIX, content));
                if (!Names.isBlank(card.privateData())) {
                    files.add(new ProjectFile(base + CardCodec.PRIVATE_SUFFIX, CardCodec.renderPrivate(card.privateData())));
                }
            }
        }
        if (!issues.isEmpty()) {
            throw new FormatException(issues);
        }
        return new Written(dir, files);
    }

    /**
     * Groups the files under {@code frames/} into frames and steps. Invalid files are reported in
     * {@code errors} and skipped; a real {@code .private.md} wins over its {@code .private.example.md}.
     */
    public static FramesResponse read(List<ProjectFile> files, ScriptLookup scripts) {
        record Slot(int order, Card card) {
        }
        record Private(String body, boolean example) {
        }
        List<String> errors = new ArrayList<>();
        Map<String, Private> privates = new LinkedHashMap<>();
        Map<String, CardRun> results = new LinkedHashMap<>();
        List<ProjectFile> cardFiles = new ArrayList<>();
        for (ProjectFile file : files) {
            Matcher r = RESULT_PATH.matcher(file.path());
            if (r.matches()) {
                results.put(r.group(1), CardCodec.parseResult(file.content()));
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

        Map<String, TreeMap<Integer, List<Slot>>> byFrame = new TreeMap<>();
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
            Card card = parsed.card().withStored(priv == null ? null : priv.body(), results.get(base));
            byFrame.computeIfAbsent(m.group(1), k -> new TreeMap<>())
                    .computeIfAbsent(Integer.parseInt(m.group(2)), k -> new ArrayList<>())
                    .add(new Slot(parsed.order(), card));
        }
        for (String base : privates.keySet()) {
            if (!claimed.contains(base)) {
                errors.add("%s: private data without a card (%s.md missing)".formatted(base, base));
            }
        }

        Comparator<Slot> byOrder = Comparator.comparingInt(Slot::order).thenComparing(slot -> slot.card().varName());
        List<Frame> frames = new ArrayList<>();
        byFrame.forEach((name, stepsByNumber) -> {
            List<Step> steps = new ArrayList<>();
            for (List<Slot> slots : stepsByNumber.values()) {
                steps.add(new Step(steps.size() + 1, slots.stream().sorted(byOrder).map(Slot::card).toList()));
            }
            frames.add(new Frame(name, steps));
        });
        return new FramesResponse(frames, errors);
    }
}
