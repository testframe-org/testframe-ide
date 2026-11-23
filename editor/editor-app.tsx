'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  CheckCircle2,
  Compass,
  Database,
  FolderDown,
  Hand,
  Layers,
  Loader2,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Square,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import type { SourcesModel } from '@/lib/sources/sources-yaml';
import { ideApi, runFrameStream, type CardResult, type HealthResponse, type RunEvent } from './api/ide';
import { problemsOf, reasonOf } from './api/http';
import { cardTypeOf, defaultSize, defaultTimeout, loadCatalog } from './catalog';
import {
  DEFAULT_FRAME,
  cardToApi,
  cardVarName,
  frameToApi,
  framesFromApi,
  pickFrame,
  slug,
  toCardRun,
  varNameToFileName
} from './frames';
import { useI18n } from './i18n';
import { setProjectInUrl, storeEnvironment, storedEnvironment, touchRecentProject } from './recent-projects';
import { displayBaseUrl, emptyModel, sourceNames, type DisplayUrl } from './sources-model';
import {
  formatElapsed,
  type CardRunView,
  type CardStatus,
  type EditorCard,
  type EditorStep,
  type ExecLog,
  type LogLevel,
  type ResizeDirection,
  type SelectedContext
} from './types';
import { CardEditModal } from './components/card-edit-modal';
import { EnvironmentPicker } from './components/environment-picker';
import { ExecutionConsole } from './components/execution-console';
import { SourcesView } from './components/sources-view';
import { StepFrame } from './components/step-frame';

interface EditorAppProps {
  /** The project from the URL (`?project=`). */
  project: string;
  onSwitchProject: () => void;
}

// Canvas viewport limits: buttons/shortcuts step by ZOOM_STEP, the wheel zooms continuously.
const DEFAULT_ZOOM = 0.92;
const DEFAULT_PAN = { x: 48, y: 36 };
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;
const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/** A stored run output as a value (JSON when it parses), for completion samples. */
function parseOutput(output: string | undefined): unknown {
  if (!output) return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

/** A card's run as the canvas shows it. */
const toRunView = (result: CardResult): CardRunView => ({
  status: result.status,
  text: result.text,
  output: result.output,
  elapsedMs: typeof result.elapsedMs === 'number' ? result.elapsedMs : null,
  ranAt: result.ranAt ?? null
});

/** The two stream events the canvas summarises once the run is over. */
type FrameFinished = Extract<RunEvent, { event: 'frame-finished' }>;
type RunErrorEvent = Extract<RunEvent, { event: 'error' }>;

/**
 * The editor for one project: the canvas of steps and cards, the Sources tab, the current
 * environment and the runs. Everything is read and written through the same-origin `/api/v2/*`
 * handlers; runs are forwarded by the IDE to the execution plugin, so editing keeps working with
 * the plugin down (only the run buttons report it).
 */
export function EditorApp({ project, onSwitchProject }: EditorAppProps) {
  const { t, lang, setLang } = useI18n();

  // --- project and frame state (steps start empty and are loaded from the project) ---
  const [projectName, setProjectName] = useState(project);
  const [frameName, setFrameName] = useState(DEFAULT_FRAME);
  const [steps, setSteps] = useState<EditorStep[]>([]);

  // --- selection and in-place editing ---
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [editingCodeCardId, setEditingCodeCardId] = useState<string | null>(null);
  const [editorCardId, setEditorCardId] = useState<string | null>(null);
  const [cardRuns, setCardRuns] = useState<Record<string, CardRunView>>({});
  const lastVarsRef = useRef<Record<string, unknown>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // --- canvas viewport (Figma-style zoom and pan) ---
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [toolMode, setToolMode] = useState<'select' | 'hand'>('select');
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLElement | null>(null);
  // Latest viewport, read by zoomTo so rapid wheel/key events compound before React re-renders
  const viewportRef = useRef({ zoom, pan });
  viewportRef.current = { zoom, pan };

  // --- runs ---
  const [isRunning, setIsRunning] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<ExecLog[]>([]);
  const [lastRunDuration, setLastRunDuration] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // --- IDE and plugin connection ---
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [ideOnline, setIdeOnline] = useState(true);

  // --- sources (the layered model), the current environment and the tab ---
  const [sourcesModel, setSourcesModel] = useState<SourcesModel>(emptyModel);
  const [sourcesErrors, setSourcesErrors] = useState<string[]>([]);
  const [sourcesProblems, setSourcesProblems] = useState<string[]>([]);
  const [sourcesWarnings, setSourcesWarnings] = useState<string[]>([]);
  const [savingSources, setSavingSources] = useState(false);
  const [openingTour, setOpeningTour] = useState(false);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [view, setView] = useState<'frames' | 'sources'>('frames');
  const [ready, setReady] = useState(false);

  const storageName = slug(projectName);

  const pushMsg = useCallback((text: string, type: LogLevel = 'info') => {
    setExecutionLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(lang), text, type }]);
  }, [lang]);

  // ------------------------------------------------------------------ bootstrap

  useEffect(() => {
    touchRecentProject(slug(project));
    let alive = true;
    (async () => {
      try {
        setHealth(await ideApi.health());
      } catch (err) {
        if (!alive) return;
        setIdeOnline(false);
        pushMsg(t('ideOfflineHint', { msg: reasonOf(err) }), 'error');
        return;
      }
      if (!alive) return;
      try {
        // Domain data comes from the IDE (catalog: source types, card kinds, defaults, mongo
        // signatures); frames need it to size the cards, so this goes first.
        await loadCatalog();
      } catch (err) {
        if (alive) pushMsg(t('catalogFail', { msg: reasonOf(err) }), 'error');
        return;
      }
      if (!alive) return;
      try {
        const data = await ideApi.loadSources(slug(project));
        if (!alive) return;
        setSourcesModel(data);
        setSourcesErrors(data.errors);
        data.errors.forEach((e) => pushMsg(e, 'error'));
        const stored = storedEnvironment(slug(project));
        const initial = data.environments.includes(stored ?? '') ? stored : (data.environments[0] ?? null);
        setEnvironment(initial);
      } catch (err) {
        // No sources.yaml yet: the project has no environments, so no run can happen yet.
        if (alive) pushMsg(t('loadedSourcesFail', { msg: reasonOf(err) }), 'error');
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
    // Runs once per project: the editor is remounted (key=project) when the project changes.
    // Everything it reads (project, t, pushMsg) is stable for that mount.
  }, []);

  // ------------------------------------------------------------------ frames

  const loadFrames = useCallback(
    async (env: string | null, quiet = false) => {
      try {
        const data = await ideApi.loadFrames(slug(projectName), env);
        if (!data.frames.length && !data.errors.length) {
          if (!quiet) pushMsg(t('noFramesSaved'), 'error');
          setSteps([]);
          setCardRuns({});
          return;
        }
        const loaded = framesFromApi(data);
        setCardRuns(loaded.results);
        const frame = pickFrame(loaded.frames, frameName);
        if (!frame) {
          if (!quiet) pushMsg(t('framesInvalid', { msg: loaded.errors[0] ?? 'unrecognized schema' }), 'error');
          return;
        }
        setFrameName(frame.name);
        setSteps(frame.steps);
        setSelectedCardId(frame.steps[0]?.cards[0]?.id ?? null);
        if (!quiet) {
          pushMsg(
            loaded.errors.length
              ? t('stepsLoadedWarn', { n: frame.steps.length, m: loaded.errors.length })
              : t('stepsLoaded', { n: frame.steps.length }),
            loaded.errors.length ? 'error' : 'success'
          );
        }
        loaded.errors.forEach((e) => pushMsg(e, 'error'));
      } catch (err) {
        pushMsg(t('framesLoadFail', { msg: reasonOf(err) }), 'error');
      }
    },
    // frameName is only the preference of which frame to show; a reload keeps the current one.
    [projectName, frameName, pushMsg, t]
  );
  const loadFramesRef = useRef(loadFrames);
  loadFramesRef.current = loadFrames;

  // The frames (with each card's last run) are re-read whenever the environment changes.
  useEffect(() => {
    if (!ready) return;
    void loadFramesRef.current(environment);
  }, [ready, environment]);

  const switchEnvironment = (env: string) => {
    setEnvironment(env);
    storeEnvironment(slug(projectName), env);
    setSteps((prev) => prev.map((s) => ({ ...s, cards: s.cards.map((c) => ({ ...c, status: 'idle' as CardStatus })) })));
    pushMsg(t('environmentSwitched', { env }), 'info');
  };

  const saveFrames = useCallback(async () => {
    try {
      const data = await ideApi.saveFrame(slug(projectName), frameToApi(frameName, steps));
      pushMsg(t('framesSaved', { n: data.saved, root: data.root }), 'success');
    } catch (err) {
      pushMsg(t('framesSaveFail', { msg: reasonOf(err) }), 'error');
      problemsOf(err).forEach((p) => pushMsg(p, 'error'));
    }
  }, [projectName, frameName, steps, pushMsg, t]);
  const saveFramesRef = useRef(saveFrames);
  saveFramesRef.current = saveFrames;

  // ------------------------------------------------------------------ sources

  const reloadSources = useCallback(async () => {
    try {
      const data = await ideApi.loadSources(slug(projectName));
      setSourcesModel(data);
      setSourcesErrors(data.errors);
      setSourcesProblems([]);
      setSourcesWarnings([]);
      data.errors.forEach((e) => pushMsg(e, 'error'));
      pushMsg(data.environments.length || Object.keys(data.layers.base).length ? t('loadedSources', { n: Object.values(data.layers.base).reduce((n, s) => n + Object.keys(s).length, 0), e: data.environments.length }) : t('noSavedSources'), 'success');
      setEnvironment((current) => {
        const kept = current && data.environments.includes(current) ? current : (data.environments[0] ?? null);
        if (kept) storeEnvironment(slug(projectName), kept);
        return kept;
      });
    } catch (err) {
      pushMsg(t('loadedSourcesFail', { msg: reasonOf(err) }), 'error');
    }
  }, [projectName, pushMsg, t]);

  const saveSources = useCallback(async () => {
    setSavingSources(true);
    try {
      const data = await ideApi.saveSources(slug(projectName), sourcesModel, environment);
      pushMsg(t('savedSources', { n: data.saved, root: data.root }), 'success');
      data.warnings.forEach((w) => pushMsg(w, 'error'));
      setSourcesProblems([]);
      setSourcesWarnings(data.warnings);
      // Re-read: the IDE wrote the layers in canonical form and may have dropped environments.
      const fresh = await ideApi.loadSources(slug(projectName));
      setSourcesModel(fresh);
      setSourcesErrors(fresh.errors);
      setEnvironment((current) => {
        const kept = current && fresh.environments.includes(current) ? current : (fresh.environments[0] ?? null);
        if (kept) storeEnvironment(slug(projectName), kept);
        return kept;
      });
    } catch (err) {
      const list = problemsOf(err);
      setSourcesProblems(list);
      pushMsg(t('savedSourcesFail', { msg: reasonOf(err) }), 'error');
      list.forEach((p) => pushMsg(p, 'error'));
    } finally {
      setSavingSources(false);
    }
  }, [projectName, sourcesModel, environment, pushMsg, t]);

  /**
   * Opens the test tour (docs/test-tour.md). The tour reads the project from disk through the
   * plugin, so the frames and the sources layers are saved first; a rejected save keeps the editor
   * where it is and reports why. The screens themselves are `@testframe/tour-ui` on the /tour page,
   * talking to the plugin through this module's /api/tour/* proxy.
   */
  const openTour = useCallback(async () => {
    if (!environment) {
      pushMsg(t('tourNeedsEnvironment'), 'error');
      return;
    }
    setOpeningTour(true);
    try {
      await ideApi.saveFrame(storageName, frameToApi(frameName, steps));
      await ideApi.saveSources(storageName, sourcesModel, environment);
      const query = new URLSearchParams({ project: storageName, env: environment });
      window.open(`/tour?${query.toString()}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      pushMsg(t('tourOpenFail', { msg: reasonOf(err) }), 'error');
      problemsOf(err).forEach((p) => pushMsg(p, 'error'));
    } finally {
      setOpeningTour(false);
    }
  }, [environment, frameName, pushMsg, sourcesModel, steps, storageName, t]);

  /** Declared source names of a type, for the card editor's name-source select. */
  const sourcesOfType = useCallback((sourceType: string): string[] => sourceNames(sourcesModel, sourceType), [sourcesModel]);

  /**
   * Display-only connection of a source in the current environment. Values that come from a
   * .private.yaml layer are secrets and are never handed to the canvas (the runs resolve them
   * server-side; the browser only learns whether there is one).
   */
  const connectionOf = useCallback(
    (sourceType: string, sourceName: string): DisplayUrl | null => {
      if (!sourceType || !sourceName) return null;
      if (!sourceNames(sourcesModel, sourceType).includes(sourceName)) return null;
      return displayBaseUrl(sourcesModel, environment, sourceType, sourceName);
    },
    [sourcesModel, environment]
  );

  // ------------------------------------------------------------------ viewport

  /** Sets the zoom keeping one canvas point fixed on screen (Figma behaviour). */
  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const { zoom: current, pan: currentPan } = viewportRef.current;
    const target = clampZoom(next);
    if (target === current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const point = anchor ?? { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
    const nextPan = {
      x: point.x - ((point.x - currentPan.x) / current) * target,
      y: point.y - ((point.y - currentPan.y) / current) * target
    };
    viewportRef.current = { zoom: target, pan: nextPan };
    setZoom(target);
    setPan(nextPan);
  }, []);

  const zoomBy = useCallback(
    (direction: 1 | -1) => {
      const current = viewportRef.current.zoom;
      zoomTo(direction > 0 ? current * ZOOM_STEP : current / ZOOM_STEP);
    },
    [zoomTo]
  );

  const resetViewport = useCallback(() => {
    viewportRef.current = { zoom: DEFAULT_ZOOM, pan: DEFAULT_PAN };
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
  }, []);

  // Wheel: Ctrl/Cmd + wheel (and trackpad pinch) zooms at the cursor, plain wheel pans.
  // Registered natively as non-passive: React's wheel listener is passive, so its preventDefault
  // cannot stop the browser from zooming the whole page.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const factor = Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.01);
        zoomTo(viewportRef.current.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        const { zoom: z, pan: p } = viewportRef.current;
        const nextPan = { x: p.x - e.deltaX, y: p.y - e.deltaY };
        viewportRef.current = { zoom: z, pan: nextPan };
        setPan(nextPan);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, zoomTo]);

  // Keyboard: Space pans, Ctrl/Cmd + '+'/'-' zoom, Ctrl+0 resets, Ctrl+S saves.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable === true;
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        setSpacePressed(true);
      }
      const zoomDirection = e.key === '+' || e.key === '=' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0;
      const withModifier = e.metaKey || e.ctrlKey;
      // only while the canvas is on screen; plain +/- never steal keys from an editor
      if (zoomDirection !== 0 && canvasRef.current && (withModifier || (!typing && !e.altKey))) {
        e.preventDefault(); // Ctrl/Cmd +/- would otherwise zoom the whole page
        zoomBy(zoomDirection as 1 | -1);
      }
      if (withModifier && e.key === '0') {
        e.preventDefault();
        resetViewport();
      }
      if (withModifier && e.key === 's') {
        e.preventDefault();
        void saveFramesRef.current();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [zoomBy, resetViewport]);

  const handleCanvasMouseDown = (e: MouseEvent<HTMLElement>) => {
    // Pan starts on the dotted background, the middle button, holding Space, or in Hand mode
    const target = e.target as HTMLElement;
    const isBackground = target === canvasRef.current || target.dataset?.canvasBg === 'true';
    if (e.button === 1 || spacePressed || toolMode === 'hand' || isBackground) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      if (isBackground && e.button === 0 && !spacePressed && toolMode === 'select') setEditingCodeCardId(null);
    }
  };

  const handleCanvasMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
  };

  const stopPanning = () => setIsPanning(false);

  // ------------------------------------------------------------------ cards and steps

  const findCardContext = useCallback(
    (cardId: string | null): SelectedContext | null => {
      for (const step of steps) {
        const found = step.cards.find((c) => c.id === cardId);
        if (found) return { card: found, stepId: step.id, stepNumber: step.number };
      }
      return null;
    },
    [steps]
  );

  const editorContext = findCardContext(editorCardId);

  const updateCard = useCallback((cardId: string, updates: Partial<EditorCard>) => {
    setSteps((prev) => prev.map((step) => ({ ...step, cards: step.cards.map((c) => (c.id === cardId ? { ...c, ...updates } : c)) })));
  }, []);

  /** Variables the edited card can reference: every card before it in run order. */
  const completionVarsFor = (cardId: string | null): Record<string, unknown> => {
    const vars: Record<string, unknown> = {};
    if (!cardId) return vars;
    for (const step of steps) {
      for (const card of step.cards) {
        if (card.id === cardId) return vars;
        const name = cardVarName(card);
        vars[name] = name in lastVarsRef.current ? lastVarsRef.current[name] : parseOutput(cardRuns[card.id]?.output);
      }
    }
    return vars;
  };

  // var-names are the binding identity of a frame (and its file names): keep them unique.
  const uniqueVarName = (base: string, taken: EditorStep[] = steps): string => {
    const used = new Set(taken.flatMap((s) => s.cards).map(cardVarName));
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    return name;
  };

  /** A new card starts without a type-source: the editor asks for it first. */
  const addCard = (stepId: string) => {
    const newId = `card-${Date.now()}`;
    const type = cardTypeOf('');
    const size = defaultSize(type);
    const newCard: EditorCard = {
      id: newId,
      title: t('defaultCardTitle'),
      varName: uniqueVarName('newCard'),
      type,
      width: size.width,
      height: size.height,
      timeout: defaultTimeout(type),
      status: 'idle',
      endpoint: '',
      sourceType: '',
      sourceName: '',
      httpMethod: '',
      code: ''
    };
    setSteps((prev) => prev.map((step) => (step.id === stepId ? { ...step, cards: [...step.cards, newCard] } : step)));
    setSelectedCardId(newId);
    setEditorCardId(newId); // a new card opens straight in the editor
  };

  const deleteCard = (cardId: string) => {
    setSteps((prev) => prev.map((step) => ({ ...step, cards: step.cards.filter((c) => c.id !== cardId) })));
    if (selectedCardId === cardId) setSelectedCardId(null);
    if (editorCardId === cardId) setEditorCardId(null);
  };

  const addNewStep = () => {
    setSteps((prev) => [...prev, { id: `step-${Date.now()}`, number: prev.length + 1, cards: [] }]);
  };

  const deleteStep = (stepId: string) => {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((s) => s.id !== stepId).map((s, index) => ({ ...s, number: index + 1 })));
  };

  /** Figma-style resize handles: the delta is divided by the zoom so the card follows the cursor. */
  const startCardResize = (e: MouseEvent, card: EditorCard, direction: ResizeDirection) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedCardId(card.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = card.width;
    const startHeight = card.height;
    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / zoom;
      const dy = (moveEvent.clientY - startY) / zoom;
      const updates: Partial<EditorCard> = {};
      if (direction === 'right' || direction === 'corner') updates.width = Math.max(165, Math.min(680, Math.round(startWidth + dx)));
      if (direction === 'bottom' || direction === 'corner') updates.height = Math.max(110, Math.min(620, Math.round(startHeight + dy)));
      updateCard(card.id, updates);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleCopyCode = (card: EditorCard) => {
    void navigator.clipboard?.writeText(card.code);
    setCopiedId(card.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // ------------------------------------------------------------------ runs

  /** Stores a card's last run for the current environment (.testframebuild/, gitignored). */
  const persistResult = (stepNumber: number, varName: string, result: CardRunView) => {
    if (!environment) return;
    const path = `${slug(frameName)}/step-${stepNumber}/${varNameToFileName(varName)}`;
    ideApi
      .saveResult(slug(projectName), environment, frameName, stepNumber, varName, toCardRun(result))
      .catch((err: Error) => pushMsg(t('resultSaveFail', { path, msg: reasonOf(err) }), 'error'));
  };

  /**
   * Runs the whole frame through the plugin (POST /api/v2/run, streamed as NDJSON): the canvas
   * animates card by card as the events arrive. The IDE builds the self-contained request
   * (resolved sources, operations, secrets); the editor never sees a secret.
   */
  const runFlow = async () => {
    if (isRunning) return;
    if (!steps.length) {
      setExecutionLogs([{ time: '00:00', text: t('runEmpty'), type: 'error' }]);
      return;
    }
    if (!environment) {
      setExecutionLogs([{ time: '00:00', text: t('runNeedsEnvironment'), type: 'error' }]);
      return;
    }

    const started = performance.now();
    const idleSteps: EditorStep[] = steps.map((s) => ({ ...s, cards: s.cards.map((c) => ({ ...c, status: 'idle' as CardStatus })) }));
    setSteps(idleSteps);
    setIsRunning(true);
    setLastRunDuration(null);
    setExecutionLogs([{ time: '00:00', text: t('suiteStarting', { name: frameName, env: environment }), type: 'info' }]);

    // card id and step number by var-name: the events name cards by var-name
    const byVar = new Map<string, { cardId: string; stepNumber: number }>();
    for (const step of idleSteps) {
      for (const card of step.cards) byVar.set(cardVarName(card), { cardId: card.id, stepNumber: step.number });
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const events: RunEvent[] = [];
    const runs: Record<string, CardRunView> = {};

    try {
      await runFrameStream(
        { project: slug(projectName), frame: frameName, environment, steps: frameToApi(frameName, idleSteps).steps ?? [] },
        (event) => {
          events.push(event);
          if (event.event === 'card-started') {
            const found = byVar.get(event.varName ?? '');
            if (found) updateCard(found.cardId, { status: 'running' });
            return;
          }
          if (event.event === 'card-finished') {
            const result = event.result;
            const found = byVar.get(result.varName);
            if (!found) return;
            const view = toRunView(result);
            runs[found.cardId] = view;
            updateCard(found.cardId, { status: result.status, ...(result.code != null ? { code: result.code } : {}) });
            setCardRuns((prev) => ({ ...prev, [found.cardId]: view }));
            pushMsg(result.text, result.status === 'error' ? 'error' : result.status === 'skipped' ? 'info' : 'success');
            persistResult(found.stepNumber, result.varName, view);
          }
        },
        controller.signal
      );

      const finished = events.find((e): e is FrameFinished => e.event === 'frame-finished');
      if (finished?.vars) lastVarsRef.current = finished.vars;
      const stopped = finished?.stopped ?? null;
      const failed =
        stopped === 'error' ||
        events.some((e) => (e.event === 'card-finished' ? e.result.status === 'error' : e.event === 'error'));
      events
        .filter((e): e is RunErrorEvent => e.event === 'error')
        .forEach((e) => pushMsg(e.message ?? 'error', 'error'));

      setLastRunDuration(formatElapsed(finished?.elapsedMs ?? performance.now() - started));
      const summary = controller.signal.aborted
        ? t('runCancelled')
        : stopped === 'deadline'
          ? t('runDeadline')
          : failed
            ? t('runStopped')
            : t('allPassed');
      pushMsg(summary, failed || stopped === 'deadline' ? 'error' : 'success');
      if (failed) {
        const failedCard = idleSteps.flatMap((s) => s.cards).find((c) => runs[c.id]?.status === 'error');
        if (failedCard) setSelectedCardId(failedCard.id);
      }
    } catch (err) {
      pushMsg(t('runFail', { msg: reasonOf(err) }), 'error');
      problemsOf(err).forEach((p) => pushMsg(p, 'error'));
    } finally {
      abortRef.current = null;
      setIsRunning(false);
    }
  };

  const cancelRun = () => abortRef.current?.abort();

  /** Runs one card (the card editor's Run button) with the variables the editor already has. */
  const runCard = async (cardId: string) => {
    if (isRunning) return;
    const ctx = findCardContext(cardId);
    const step = steps.find((s) => s.id === ctx?.stepId);
    if (!ctx || !step) return;
    if (!environment) {
      pushMsg(t('runNeedsEnvironment'), 'error');
      return;
    }

    const vars: Record<string, unknown> = { ...lastVarsRef.current };
    const before: EditorCard[] = [];
    for (const s of steps) {
      const idx = s.cards.findIndex((c) => c.id === cardId);
      before.push(...(idx >= 0 ? s.cards.slice(0, idx) : s.cards));
      if (idx >= 0) break;
    }
    for (const c of before) {
      const key = cardVarName(c);
      if (c.type === 'json' && vars[key] === undefined) {
        try {
          vars[key] = JSON.parse(c.code);
        } catch {
          /* unresolved templates: skip */
        }
      }
    }
    // The step's JSON cards around the card: its request payload and its result card
    const position = step.cards.findIndex((c) => c.id === cardId);
    const jsonBefore = position >= 0 ? step.cards.slice(0, position).filter((c) => c.type === 'json').reverse() : [];
    const resultCard = position >= 0 ? step.cards.slice(position + 1).find((c) => c.type === 'json') : undefined;

    setIsRunning(true);
    updateCard(cardId, { status: 'running' });
    try {
      const run = await ideApi.runCard(
        slug(projectName),
        environment,
        step.number,
        cardToApi(ctx.card),
        vars,
        jsonBefore[0]?.code ?? null,
        resultCard ? { varName: cardVarName(resultCard), code: resultCard.code } : null
      );
      const view = toRunView(run.result);
      updateCard(cardId, { status: run.result.status });
      // A successful request/mongo run published the result card's variable: mirror its body
      if (resultCard && run.vars[cardVarName(resultCard)] !== undefined) {
        updateCard(resultCard.id, { code: JSON.stringify(run.vars[cardVarName(resultCard)], null, 2) });
      }
      setCardRuns((prev) => ({ ...prev, [cardId]: view }));
      pushMsg(view.text, view.status === 'error' ? 'error' : 'success');
      lastVarsRef.current = run.vars;
      persistResult(step.number, cardVarName(ctx.card), view);
    } catch (err) {
      const reason = reasonOf(err);
      updateCard(cardId, { status: 'error' });
      setCardRuns((prev) => ({ ...prev, [cardId]: { status: 'error', text: reason, output: reason, elapsedMs: null, ranAt: null } }));
      pushMsg(reason, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  // ------------------------------------------------------------------ header bits

  const refreshRunner = async () => {
    try {
      setHealth({ ...(health ?? { status: 'UP', service: 'testframe-ide' }), runner: await ideApi.runnerHealth() });
    } catch (err) {
      pushMsg(reasonOf(err), 'error');
    }
  };

  const runner = health?.runner;
  const runnerLabel = !runner
    ? t('runnerChecking')
    : runner.status === 'up'
      ? t('runnerUp')
      : runner.status === 'down'
        ? t('runnerDown')
        : runner.status === 'incompatible'
          ? t('runnerIncompatible')
          : t('runnerUnconfigured');
  const runnerHint = !runner
    ? t('runnerCheckingHint')
    : runner.status === 'up'
      ? t('runnerUpHint', { name: runner.name ?? '', version: runner.version ?? '', url: runner.url ?? '' })
      : runner.status === 'unconfigured'
        ? t('runnerUnconfiguredHint')
        : t('runnerDownHint', { msg: runner.message ?? '' });
  const runnerDot = !runner ? 'bg-slate-300 animate-pulse' : runner.status === 'up' ? 'bg-emerald-500' : 'bg-rose-500';

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#F5F5F7] text-slate-800 select-none font-sans">
      {/* ------------------------------------------------------------ TOP BAR */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between z-30 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/90 rounded-lg px-2.5 py-1.5 shadow-xs">
            <button
              type="button"
              onClick={onSwitchProject}
              title={t('switchProject')}
              aria-label={t('switchProject')}
              className="w-6 h-6 rounded-md bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-xs"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
            <label className="sr-only" htmlFor="project-name">
              {t('projectNameLabel')}
            </label>
            <input
              id="project-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={() => {
                // the storage folder is slug(projectName): keep the URL and the recents in sync
                const name = slug(projectName);
                setProjectInUrl(name, true);
                touchRecentProject(name);
              }}
              aria-label={t('projectNameLabel')}
              className="font-semibold text-sm text-slate-800 bg-transparent border-none outline-none focus:ring-2 focus:ring-blue-500/30 rounded px-1 w-36 sm:w-44"
            />
            <span className="text-slate-300 text-sm">/</span>
            <label className="sr-only" htmlFor="frame-name">
              {t('frameNameLabel')}
            </label>
            <input
              id="frame-name"
              type="text"
              value={frameName}
              onChange={(e) => setFrameName(e.target.value)}
              onBlur={() => setFrameName((name) => slug(name))}
              aria-label={t('frameNameLabel')}
              title={t('frameNameLabel')}
              className="font-mono text-xs text-slate-600 bg-transparent border-none outline-none focus:ring-2 focus:ring-blue-500/30 rounded px-1 w-28 sm:w-36"
            />
            <span className="hidden lg:inline text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200/70">
              {t('suiteBadge')}
            </span>
          </div>

          {/* IDE / execution plugin status (click to re-check the plugin) */}
          <button
            type="button"
            onClick={refreshRunner}
            title={ideOnline ? runnerHint : t('ideOfflineHint', { msg: '' })}
            className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border bg-white hover:bg-slate-50"
          >
            <span className={`w-2 h-2 rounded-full ${ideOnline ? runnerDot : 'bg-rose-500'}`} />
            <span className="text-slate-600 font-mono">{ideOnline ? runnerLabel : t('ideOffline')}</span>
          </button>

          {/* Tool selector (cursor / hand) */}
          <div className="hidden md:flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
            <button
              type="button"
              onClick={() => setToolMode('select')}
              title={t('selectTool')}
              aria-label={t('selectTool')}
              className={`p-1.5 rounded-md transition-colors ${toolMode === 'select' && !spacePressed ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <MousePointer2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setToolMode('hand')}
              title={t('handTool')}
              aria-label={t('handTool')}
              className={`p-1.5 rounded-md transition-colors ${toolMode === 'hand' || spacePressed ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <Hand className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center: zoom controls */}
        <div className="flex items-center gap-1.5 bg-slate-100/90 border border-slate-200/80 rounded-lg px-2 py-1">
          <button type="button" onClick={() => zoomBy(-1)} title={t('zoomOut')} aria-label={t('zoomOut')} className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-semibold text-slate-700 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1)} title={t('zoomIn')} aria-label={t('zoomIn')} className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-slate-300 mx-0.5" />
          <button type="button" onClick={resetViewport} title={t('fitView')} className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 transition-colors flex items-center gap-1 text-xs font-medium px-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{t('fit')}</span>
          </button>
        </div>

        {/* Right: environment, language, persistence and the run */}
        <div className="flex items-center gap-2.5">
          <EnvironmentPicker environments={sourcesModel.environments} value={environment} onChange={switchEnvironment} />

          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80" role="group" aria-label="Language">
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${lang === 'en' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang('pt-BR')}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${lang === 'pt-BR' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              PT
            </button>
          </div>

          {lastRunDuration && !isRunning && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {lastRunDuration}
            </span>
          )}

          <button
            type="button"
            onClick={() => void loadFrames(environment)}
            title={t('loadHint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98]"
          >
            <FolderDown className="w-3.5 h-3.5 text-slate-500" />
            {t('load')}
          </button>

          <button
            type="button"
            onClick={() => void saveFrames()}
            title={t('saveFramesHint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98]"
          >
            <Save className="w-3.5 h-3.5 text-emerald-600" />
            {t('saveFrames')}
          </button>

          <button
            type="button"
            onClick={addNewStep}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            {t('newStep')}
          </button>

          <button
            type="button"
            onClick={() => void openTour()}
            disabled={openingTour || isRunning}
            title={t('tourHint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {openingTour ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" /> : <Compass className="w-3.5 h-3.5 text-indigo-600" />}
            {openingTour ? t('tourOpening') : t('tour')}
          </button>

          <button
            type="button"
            onClick={() => (isRunning ? cancelRun() : void runFlow())}
            title={isRunning ? t('cancelRun') : t('runFlow')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-sm active:scale-[0.98] ${
              isRunning ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
            }`}
          >
            {isRunning ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                {t('running')}
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                {t('runFlow')}
              </>
            )}
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------ TABS */}
      <nav role="tablist" className="h-10 bg-white border-b border-slate-200 px-4 flex items-end gap-1 shrink-0 z-20">
        {(
          [
            ['frames', t('tabFrames'), Layers],
            ['sources', t('tabSources'), Database]
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`flex items-center gap-1.5 px-3.5 h-9 -mb-px text-xs font-semibold border-b-2 transition-colors ${
              view === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${id === 'sources' ? 'text-purple-600' : 'text-blue-600'}`} />
            {label}
            {id === 'sources' && (
              <span className="text-[10px] font-mono px-1.5 rounded-full bg-slate-100 text-slate-500">
                {Object.values(sourcesModel.layers.base).reduce((n, s) => n + Object.keys(s).length, 0)}
              </span>
            )}
          </button>
        ))}
        {isRunning && (
          <span className="ml-auto mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-blue-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('running')}
          </span>
        )}
      </nav>

      {/* ------------------------------------------------------------ MAIN AREA */}
      {view === 'sources' ? (
        <SourcesView
          project={storageName}
          model={sourcesModel}
          loadErrors={sourcesErrors}
          problems={sourcesProblems}
          warnings={sourcesWarnings}
          saving={savingSources}
          currentEnvironment={environment}
          onChange={setSourcesModel}
          onSave={() => void saveSources()}
          onReload={() => void reloadSources()}
        />
      ) : (
        <div className="flex-1 flex overflow-hidden relative">
          <main
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={stopPanning}
            onMouseLeave={stopPanning}
            data-canvas-bg="true"
            style={{
              backgroundImage: 'radial-gradient(#CBD5E1 1.25px, transparent 1.25px)',
              backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`
            }}
            className={`flex-1 relative overflow-hidden bg-[#F7F8FA] ${
              isPanning ? 'cursor-grabbing' : spacePressed || toolMode === 'hand' ? 'cursor-grab' : 'cursor-default'
            }`}
          >
            {/* Container transformed by pan and zoom */}
            <div
              data-canvas-bg="true"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
              className="inline-flex flex-col gap-7 pb-32 pr-32 transition-transform duration-75 ease-out"
            >
              {steps.map((step) => (
                <StepFrame
                  key={step.id}
                  step={step}
                  totalSteps={steps.length}
                  selectedCardId={selectedCardId}
                  editingCodeCardId={editingCodeCardId}
                  copiedId={copiedId}
                  cardRuns={cardRuns}
                  zoom={zoom}
                  completionVarsFor={completionVarsFor}
                  onSelectCard={setSelectedCardId}
                  onStartEditCode={setEditingCodeCardId}
                  onStopEditCode={() => setEditingCodeCardId(null)}
                  onOpenEditor={(id) => {
                    setSelectedCardId(id);
                    setEditorCardId(id);
                  }}
                  onUpdateCard={updateCard}
                  onStartCardResize={startCardResize}
                  onAddCard={addCard}
                  onDeleteStep={deleteStep}
                  onCopyCode={handleCopyCode}
                />
              ))}

              {/* Empty state or "add step" at the end of the canvas */}
              {steps.length === 0 ? (
                <div className="flex items-center justify-center py-24">
                  <div className="flex flex-col items-center gap-3 text-center max-w-sm">
                    <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                      <Sliders className="w-6 h-6 text-blue-600" />
                    </div>
                    <p className="text-sm font-bold text-slate-700">{t('noStepsTitle')}</p>
                    <p className="text-xs text-slate-500 -mt-1">{ready ? t('noStepsHint') : t('loading')}</p>
                    <button
                      type="button"
                      onClick={addNewStep}
                      className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-all shadow-md shadow-blue-600/20 active:scale-[0.98]"
                    >
                      <Plus className="w-4 h-4" />
                      {t('addStepToEnd', { n: 1 })}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center pt-1">
                  <button
                    type="button"
                    onClick={addNewStep}
                    className="group flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-dashed border-slate-300 bg-white/70 hover:bg-white hover:border-blue-400 text-slate-500 hover:text-blue-600 text-xs font-semibold transition-all shadow-2xs"
                  >
                    <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
                    {t('addStepToEnd', { n: steps.length + 1 })}
                  </button>
                </div>
              )}
            </div>

            {/* Bottom floating bar: hints and the execution console */}
            <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between pointer-events-none z-20">
              <div className="pointer-events-auto bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-lg px-3 py-1.5 text-[11px] text-slate-500 shadow-sm flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono text-slate-700">{t('hintSpaceDrag')}</kbd>
                  {t('hintMoveCanvas')}
                </span>
                <span className="text-slate-300">|</span>
                <span>{t('hintResize')}</span>
                {environment && (
                  <>
                    <span className="text-slate-300">|</span>
                    <span className="font-mono" title={t('environmentHint')}>
                      {t('environmentLabel')}: {environment}
                    </span>
                  </>
                )}
              </div>

              <ExecutionConsole logs={executionLogs} running={isRunning} onClear={() => setExecutionLogs([])} onCancel={cancelRun} />
            </div>
          </main>
        </div>
      )}

      {/* The card editor (opened from a card's Edit button) */}
      <CardEditModal
        selectedContext={editorContext}
        project={storageName}
        environment={environment}
        sourcesOfType={sourcesOfType}
        connectionOf={connectionOf}
        onClose={() => setEditorCardId(null)}
        onRun={(id) => void runCard(id)}
        running={isRunning}
        lastRun={editorCardId ? cardRuns[editorCardId] : undefined}
        onUpdateCard={updateCard}
        onDeleteCard={deleteCard}
        onOpenSources={() => {
          setEditorCardId(null);
          setView('sources');
        }}
        onLog={pushMsg}
        completionVars={completionVarsFor(editorCardId)}
      />
    </div>
  );
}
