package com.testframe.server.service;

import com.testframe.server.dto.Card;
import com.testframe.server.dto.CardRun;
import com.testframe.server.dto.Frame;
import com.testframe.server.dto.FramesResponse;
import com.testframe.server.dto.Step;
import com.testframe.server.format.CardCodec;
import com.testframe.server.format.FormatException;
import com.testframe.server.format.FrameCodec;
import com.testframe.server.format.Names;
import com.testframe.server.openapi.OpenApiService;
import com.testframe.server.openapi.OpenApiSpec;
import com.testframe.server.store.ProjectFileStore;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Frames of a project in the on-disk format ({@code testframe/frames/}). Openapi cards are
 * checked against their source's cached operations on load.
 */
@Service
public class FrameService {

    static final String FRAMES_DIR = "testframe/frames";

    private final ProjectFileStore store;
    private final SourceService sources;
    private final OpenApiService openApi;

    public FrameService(ProjectFileStore store, SourceService sources, OpenApiService openApi) {
        this.store = store;
        this.sources = sources;
        this.openApi = openApi;
    }

    /**
     * Frames of the project; {@code errors} also carries the warnings: an openapi card whose endpoint is not an operation of its source's spec (checked only
     * when the spec can be read).
     */
    public FramesResponse load(String project) throws IOException {
        FramesResponse read = FrameCodec.read(store.list(project, FRAMES_DIR));
        List<String> errors = new ArrayList<>(read.errors());
        for (Frame frame : read.frames()) {
            for (Step step : frame.steps()) {
                for (Card card : step.cards()) {
                    endpointWarning(project, card).ifPresent(warning -> errors.add("%s/step-%d/%s: %s".formatted(
                            frame.name(), step.number(), Names.varNameToFileName(card.varName()), warning)));
                }
            }
        }
        return new FramesResponse(read.frames(), errors);
    }

    private Optional<String> endpointWarning(String project, Card card) {
        if (!OpenApiService.TYPE.equals(card.sourceType()) || Names.isBlank(card.sourceName())
                || Names.isBlank(card.endpoint())) {
            return Optional.empty();
        }
        try {
            OpenApiSpec spec = openApi.spec(project, card.sourceName());
            String endpoint = Names.trim(card.endpoint());
            if (Names.isBlank(card.openapiId())) {
                return spec.has(endpoint) ? Optional.empty()
                        : Optional.of("endpoint \"%s\" is not an operation of the openapi/%s spec"
                        .formatted(endpoint, card.sourceName()));
            }
            // the operationId is the identity: the endpoint must still be its method + path
            Optional<OpenApiSpec.Operation> op = spec.byId(card.openapiId());
            if (op.isEmpty()) {
                return Optional.of("openapi-id \"%s\" is not an operation of the openapi/%s spec"
                        .formatted(card.openapiId(), card.sourceName()));
            }
            return op.get().endpoint().equalsIgnoreCase(endpoint.replaceAll("\\s+", " ")) ? Optional.empty()
                    : Optional.of("endpoint \"%s\" no longer matches operation %s (%s) of the openapi/%s spec"
                    .formatted(endpoint, card.openapiId(), op.get().endpoint(), card.sourceName()));
        } catch (IOException | RuntimeException e) {
            return Optional.empty(); // spec unavailable: nothing to compare with (the editor shows why)
        }
    }

    /** Replaces {@code frames/{slug(frame.name)}/} with the frame; other frames are untouched. */
    public Map<String, Object> save(String project, Frame frame) throws IOException {
        if (frame == null) {
            throw new FormatException("frame is required");
        }
        FrameCodec.Written written = FrameCodec.write(frame);
        return store.replace(project, FRAMES_DIR, List.of(written.dir()), List.of(), written.files());
    }

    /** Stores the last run of a card next to it ({@code {var-file}.cache.md}, gitignored). */
    public Map<String, Object> saveResult(String project, String frame, Integer step, String varName, CardRun result)
            throws IOException {
        if (frame == null || frame.isBlank() || step == null || step < 1 || varName == null || varName.isBlank()
                || result == null) {
            throw new FormatException("frame, step (>= 1), varName and result are required");
        }
        String path = FrameCodec.cardBase(frame, step, varName) + CardCodec.CACHE_SUFFIX;
        return store.saveCache(project, FRAMES_DIR, path, CardCodec.renderResult(result));
    }
}
