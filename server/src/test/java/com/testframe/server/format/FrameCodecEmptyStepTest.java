package com.testframe.server.format;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
import com.testframe.server.dto.Step;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FrameCodecEmptyStepTest {

    private static Card json(String varName) {
        return new Card(varName, "Title of " + varName, null, "rawvalue", "json", null, null, "", null, null,
                null, null, null, null, "{ \"a\": 1 }", null, null);
    }

    @Test
    void emptyMiddleAndLastStepsRoundTrip() {
        Frame frame = new Frame("Demo", List.of(
                new Step(1, List.of(json("first"))),
                new Step(2, List.of()),
                new Step(3, List.of(json("third"))),
                new Step(4, List.of())));
        FrameCodec.Written written = FrameCodec.write(frame);
        List<String> paths = written.files().stream().map(ProjectFile::path).toList();
        assertTrue(paths.contains("demo/step-2/flow.md"), paths.toString());
        assertTrue(paths.contains("demo/step-4/flow.md"), paths.toString());

        FramesResponse back = FrameCodec.read(written.files());
        assertEquals(List.of(), back.errors());
        List<Step> steps = back.frames().get(0).steps();
        assertEquals(4, steps.size());
        assertEquals(List.of(1, 2, 3, 4), steps.stream().map(Step::number).toList());
        assertEquals(1, steps.get(0).cards().size());
        assertEquals(0, steps.get(1).cards().size());
        assertEquals("third", steps.get(2).cards().get(0).varName());
        assertEquals(0, steps.get(3).cards().size());
    }

    @Test
    void stepWithCardsKeepsItsFlowListing() {
        FrameCodec.Written written = FrameCodec.write(new Frame("Demo", List.of(new Step(1, List.of(json("alpha"), json("beta"))))));
        ProjectFile flow = written.files().stream().filter(f -> f.path().equals("demo/step-1/flow.md")).findFirst().orElseThrow();
        assertEquals(MdEnvelope.render("alpha\nbeta"), flow.content());
        assertEquals(3, written.files().size());
    }
}
