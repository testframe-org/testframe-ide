package com.testframe.server.service;

import com.testframe.server.dto.CardRun;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
import com.testframe.server.format.CardCodec;
import com.testframe.server.format.FormatException;
import com.testframe.server.format.FrameCodec;
import com.testframe.server.format.ScriptLookup;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Frames of a project in the on-disk format ({@code testframe/frames/}). Cards bound to a
 * source script are resolved against the project's saved sources.
 */
@Service
public class FrameService {

    static final String FRAMES_DIR = "testframe/frames";

    private final ProjectFileStore store;
    private final SourceService sources;

    public FrameService(ProjectFileStore store, SourceService sources) {
        this.store = store;
        this.sources = sources;
    }

    public FramesResponse load(String project) throws IOException {
        ScriptLookup scripts = ScriptLookup.of(sources.load(project));
        return FrameCodec.read(store.list(project, FRAMES_DIR), scripts);
    }

    /** Replaces {@code frames/{slug(frame.name)}/} with the frame; other frames are untouched. */
    public Map<String, Object> save(String project, Frame frame) throws IOException {
        if (frame == null) {
            throw new FormatException("frame is required");
        }
        ScriptLookup scripts = ScriptLookup.of(sources.load(project));
        FrameCodec.Written written = FrameCodec.write(frame, scripts);
        return store.replace(project, FRAMES_DIR, List.of(written.dir()), List.of(), written.files());
    }

    /** Stores the last run of a card next to it ({@code {var-file}.result-data.md}, gitignored). */
    public Map<String, Object> saveResult(String project, String frame, Integer step, String varName, CardRun result)
            throws IOException {
        if (frame == null || frame.isBlank() || step == null || step < 1 || varName == null || varName.isBlank()
                || result == null) {
            throw new FormatException("frame, step (>= 1), varName and result are required");
        }
        String path = FrameCodec.cardBase(frame, step, varName) + CardCodec.RESULT_SUFFIX;
        return store.saveResult(project, path, CardCodec.renderResult(result));
    }
}
