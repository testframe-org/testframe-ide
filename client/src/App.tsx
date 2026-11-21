import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Plus,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  CheckCircle2,
  Loader2,
  Database,
  Sliders,
  Layers,
  MousePointer2,
  Hand,
  Save,
  FolderDown
} from 'lucide-react';
import { buildFrameFiles, endpointParts, rebuildSteps, slug, substituteTemplates, toVarName, unwrapSourcesFromLoad } from './frames';
import { runTargetRequest, testframeApi } from './client-api';
import { useI18n } from './i18n';
import { ExecutionConsole } from './components/ExecutionConsole';
import { InspectorPanel } from './components/InspectorPanel';
import { SourcesModal } from './components/SourcesModal';
import { StepFrame } from './components/StepFrame';
import type {
  Card,
  CardStatus,
  ExecLog,
  HttpResult,
  LogLevel,
  PhaseKey,
  ResizeDirection,
  SelectedContext,
  SourceDef,
  Step
} from './types';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function App() {
  const { t, lang, setLang } = useI18n();

  // Project state. Steps start empty and are loaded from the project .md files
  const [projectName, setProjectName] = useState<string>(
    import.meta.env.VITE_PROJECT ?? 'product-test'
  );
  const [steps, setSteps] = useState<Step[]>([]);

  // Selection and editing
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [editingCodeCardId, setEditingCodeCardId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Canvas viewport (Figma-style zoom and pan)
  const [zoom, setZoom] = useState(0.92);
  const [pan, setPan] = useState({ x: 48, y: 36 });
  const [toolMode, setToolMode] = useState<'select' | 'hand'>('select');
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLElement | null>(null);

  // Flow execution state
  const [isRunning, setIsRunning] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<ExecLog[]>([]);
  const [lastRunDuration, setLastRunDuration] = useState<string | null>(null);

  // Backend connection state (Spring Boot)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  // Sources and frame persistence (.md files in the project folder)
  const [sources, setSources] = useState<SourceDef[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const saveFramesRef = useRef<(() => Promise<void>) | null>(null);

  const pushFrameMsg = useCallback(
    (text: string, type: LogLevel = 'info') => {
      setExecutionLogs((prev) => [...prev, { time: 'frames', text, type }]);
    },
    []
  );

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const health = await testframeApi.health();
        setApiOnline(health.status === 'UP');
      } catch {
        setApiOnline(false);
        return; // server down: nothing else to load
      }

      const project = slug(projectName);

      // Silent auto-load of persisted sources and frames
      try {
        const data = await testframeApi.loadSources(project);
        if (data.sources?.length) setSources(unwrapSourcesFromLoad(data.sources));
      } catch {
        /* no saved sources yet */
      }

      try {
        const data = await testframeApi.loadFrames(project);
        if (data.files.length) {
          const loaded = rebuildSteps(data.files);
          if (loaded.steps.length) {
            setSteps(loaded.steps);
            setSelectedCardId(loaded.steps[0]?.preCards[0]?.id ?? null);
            if (loaded.errors.length) {
              pushFrameMsg(
                t('stepsLoadedWarn', { n: loaded.steps.length, m: loaded.errors.length }),
                'error'
              );
            }
          }
        }
      } catch {
        /* no saved frames yet */
      }
    };
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts (Space for pan, Ctrl+0 to reset zoom, Ctrl+S to save)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        setSpacePressed(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        resetViewport();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveFramesRef.current?.();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Find the currently selected card
  const findSelectedCard = useCallback((): SelectedContext | null => {
    const phases: PhaseKey[] = ['preCards', 'postCards'];
    for (const step of steps) {
      for (const phase of phases) {
        const found = step[phase].find((c) => c.id === selectedCardId);
        if (found) {
          return {
            card: found,
            stepId: step.id,
            stepNumber: step.number,
            phaseKey: phase
          };
        }
      }
    }
    return null;
  }, [steps, selectedCardId]);

  const selectedContext = findSelectedCard();

  // Update a specific card property
  const updateCard = useCallback((cardId: string, updates: Partial<Card>) => {
    setSteps((prev) =>
      prev.map((step) => ({
        ...step,
        preCards: step.preCards.map((c) => (c.id === cardId ? { ...c, ...updates } : c)),
        postCards: step.postCards.map((c) => (c.id === cardId ? { ...c, ...updates } : c))
      }))
    );
  }, []);

  // Add a new card to a phase (pre or post)
  const addCardToPhase = (stepId: string, phaseKey: PhaseKey) => {
    const isPre = phaseKey === 'preCards';
    const newId = `card-${Date.now()}`;
    const newCard: Card = {
      id: newId,
      title: isPre ? t('defaultRequestTitle') : t('defaultAssertionTitle'),
      varName: toVarName(isPre ? t('defaultRequestTitle') : t('defaultAssertionTitle')),
      type: isPre ? 'request' : 'validation',
      width: 240,
      height: 165,
      timeout: 3000,
      status: 'idle',
      endpoint: isPre ? 'POST /api/v2/echo' : t('defaultSchemaEndpoint'),
      sourceType: isPre ? 'restapi' : 'inline',
      sourceName: isPre ? 'framework-echo-api' : 'assercoes',
      httpMethod: isPre ? 'POST' : '',
      code: isPre
        ? `// New execution step\nconst res = await api.post('/api/v2/echo', {\n  ping: true\n});`
        : `// Validate response\nexpect(res.status).toBe(200);`
    };

    setSteps((prev) =>
      prev.map((step) =>
        step.id === stepId
          ? ({ ...step, [phaseKey]: [...step[phaseKey], newCard] } as Step)
          : step
      )
    );
    setSelectedCardId(newId);
  };

  // Remove card
  const deleteCard = (cardId: string) => {
    setSteps((prev) =>
      prev.map((step) => ({
        ...step,
        preCards: step.preCards.filter((c) => c.id !== cardId),
        postCards: step.postCards.filter((c) => c.id !== cardId)
      }))
    );
    if (selectedCardId === cardId) {
      setSelectedCardId(null);
    }
  };

  // Add a new step
  const addNewStep = () => {
    const nextNumber = steps.length + 1;
    const newStepId = `step-${Date.now()}`;
    const preId = `card-${nextNumber}-pre-1`;
    const postId = `card-${nextNumber}-post-1`;

    const newStep: Step = {
      id: newStepId,
      number: nextNumber,
      splitRatio: 48,
      preCards: [
        {
          id: preId,
          title: t('defaultStepTitle', { n: nextNumber }),
          varName: toVarName(t('defaultStepTitle', { n: nextNumber })),
          type: 'request',
          width: 320,
          height: 210,
          timeout: 5000,
          status: 'idle',
          endpoint: 'POST /api/v2/echo',
          sourceType: 'restapi',
          sourceName: 'framework-echo-api',
          httpMethod: 'POST',
          code: `// Step ${nextNumber} - service call\nconst result = await api.post('/api/v2/echo', {\n  test: 'step-${nextNumber}'\n});`
        }
      ],
      postCards: [
        {
          id: postId,
          title: t('defaultJsonResultTitle'),
          varName: toVarName(t('defaultJsonResultTitle')),
          type: 'json',
          width: 290,
          height: 185,
          timeout: 2000,
          status: 'idle',
          endpoint: '200 OK',
          sourceType: 'inline',
          sourceName: 'resultado-etapa',
          httpMethod: '',
          code: `{\n  "status": "PROCESSED",\n  "request_id": "REQ-${nextNumber}"\n}`
        }
      ]
    };

    setSteps((prev) => [...prev, newStep]);
    setSelectedCardId(preId);
  };

  // Remove step
  const deleteStep = (stepId: string) => {
    if (steps.length <= 1) return;
    setSteps((prev) =>
      prev
        .filter((s) => s.id !== stepId)
        .map((s, idx) => ({ ...s, number: idx + 1 }))
    );
  };

  // --- ZOOM & PAN CONTROLS ---
  const handleZoomIn = () => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.45, +(z - 0.1).toFixed(2)));
  const resetViewport = () => {
    setZoom(0.92);
    setPan({ x: 48, y: 36 });
  };

  const handleWheel = (e: React.WheelEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.06 : 0.06;
      setZoom((z) => Math.min(1.6, Math.max(0.45, +(z + delta).toFixed(2))));
    } else {
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY
      }));
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    // Pan starts when clicking the dotted background, the middle button, holding Space, or in Hand mode
    const target = e.target as HTMLElement;
    const isBackground = target === canvasRef.current || target.dataset?.canvasBg === 'true';
    if (e.button === 1 || spacePressed || toolMode === 'hand' || isBackground) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      if (isBackground && e.button === 0 && !spacePressed && toolMode === 'select') {
        setEditingCodeCardId(null);
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y
    });
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
  };

  // --- CARD RESIZING (FIGMA-STYLE HANDLES) ---
  const startCardResize = (e: React.MouseEvent, card: Card, direction: ResizeDirection) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedCardId(card.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = card.width;
    const startHeight = card.height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / zoom;
      const dy = (moveEvent.clientY - startY) / zoom;

      const updates: Partial<Card> = {};
      if (direction === 'right' || direction === 'corner') {
        updates.width = Math.max(165, Math.min(680, Math.round(startWidth + dx)));
      }
      if (direction === 'bottom' || direction === 'corner') {
        updates.height = Math.max(110, Math.min(620, Math.round(startHeight + dy)));
      }
      updateCard(card.id, updates);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // --- PRE / POST SPLIT DIVIDER RESIZING ---
  const startSplitResize = (
    e: React.MouseEvent,
    stepId: string,
    currentRatio: number,
    containerEl: HTMLElement | null
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    const startX = e.clientX;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const deltaPercent = (dx / rect.width) * 100;
      const nextRatio = Math.max(25, Math.min(75, Math.round(currentRatio + deltaPercent)));
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, splitRatio: nextRatio } : s))
      );
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // --- TEST FLOW EXECUTION (real requests + simulated assertions) ---
  const runFlowSimulation = async () => {
    if (isRunning) return;

    if (!steps.length) {
      setExecutionLogs([{ time: '00:00', text: t('runEmpty'), type: 'error' }]);
      return;
    }

    setIsRunning(true);
    setLastRunDuration(null);
    const startTime = performance.now();

    // Reset every card to idle
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        preCards: s.preCards.map((c) => ({ ...c, status: 'idle' as CardStatus })),
        postCards: s.postCards.map((c) => ({ ...c, status: 'idle' as CardStatus }))
      }))
    );

    const logs: ExecLog[] = [];
    setExecutionLogs([{ time: '00:00', text: t('suiteStarting', { name: projectName }), type: 'info' }]);

    // Variables produced by cards, addressable in later steps via {{varName}}
    const vars: Record<string, unknown> = {};
    const varKey = (c: Card) => c.varName || toVarName(c.title);

    for (const step of steps) {
      const orderedCards: Card[] = [...step.preCards, ...step.postCards];
      for (const card of orderedCards) {
        setSelectedCardId(card.id);
        updateCard(card.id, { status: 'running' });

        const elapsedOf = () => `${((performance.now() - startTime) / 1000).toFixed(2)}s`;
        const stepLabel = t('logStep', { n: step.number });

        // Forced failure only through an explicit marker in the code
        const shouldFail =
          card.code.toLowerCase().includes('force_fail') ||
          card.code.toLowerCase().includes('expect(false).tobe(true)');

        let http: HttpResult | null = null;
        let assertion: { passed?: boolean; actual?: unknown; expected?: unknown; operator?: string } | null = null;
        if (card.type === 'validation' && /^assert\b/i.test(card.code.trim())) {
          // Live assertion against the framework engine (source type: assert)
          let input: unknown = {};
          for (const source of [...step.postCards, ...step.preCards]) {
            if (source.type === 'json' && source.id !== card.id) {
              try {
                input = substituteTemplates(JSON.parse(source.code), vars);
                break;
              } catch {
                /* try the next json card */
              }
            }
          }
          const assertRes = await runTargetRequest('POST', '/api/v2/assertions', {
            expression: card.code.trim(),
            input
          });
          if (assertRes.ok) {
            try {
              assertion = JSON.parse(assertRes.text);
            } catch {
              assertion = null;
            }
          } else {
            assertion = { passed: false, actual: `HTTP ${assertRes.status}`, expected: assertRes.text };
          }
        } else if (card.type === 'request') {
          const parts = endpointParts(card);
          if (parts) {
            const payloadCard = step.preCards.find((c) => c.type === 'json');
            let body: unknown;
            if (payloadCard) {
              try {
                body = substituteTemplates(JSON.parse(payloadCard.code), vars);
              } catch {
                body = undefined;
              }
            }
            http = await runTargetRequest(parts.method, parts.path, body);
          } else {
            await new Promise<void>((r) => setTimeout(r, 420));
          }
        } else {
          await new Promise<void>((r) => setTimeout(r, 420));
        }

        let nextStatus: CardStatus;
        let logText: string;

        if (assertion) {
          nextStatus = assertion.passed && !shouldFail ? 'success' : 'error';
          logText = `${stepLabel} ${card.title}: assert ${assertion.passed ? t('logOk') : t('logAssertFail')} (${JSON.stringify(assertion.actual)} ${assertion.operator ?? ''} ${JSON.stringify(assertion.expected)})`;
          vars[varKey(card)] = assertion;
        } else if (http) {
          nextStatus = http.ok && !shouldFail ? 'success' : 'error';
          logText = `${stepLabel} ${card.title}: HTTP ${http.status} ${http.statusText} (${http.ms}ms)`;
          if (http.ok) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(http.text);
            } catch {
              parsed = http.text;
            }
            vars[varKey(card)] = parsed;
            // Feed the step's JSON result card with the real server response
            const jsonCard = step.postCards.find((c) => c.type === 'json');
            if (jsonCard) {
              const pretty =
                typeof parsed === 'string' ? http.text : JSON.stringify(parsed, null, 2);
              updateCard(jsonCard.id, {
                code: pretty,
                endpoint: `${http.status} ${http.statusText} • ${http.ms}ms`
              });
              vars[varKey(jsonCard)] = parsed;
            }
          }
        } else {
          nextStatus = shouldFail ? 'error' : 'success';
          logText = `${stepLabel} ${card.title}: ${shouldFail ? t('logAssertFail') : t('logOk')}`;
          // Simulated cards still publish variables so later steps can bind their data
          if (!shouldFail && card.type === 'json') {
            try {
              vars[varKey(card)] = JSON.parse(card.code);
            } catch {
              /* contains unresolved templates: keep without publishing */
            }
          } else if (!shouldFail && card.type === 'script') {
            const resultCard = step.postCards.find((c) => c.type === 'json');
            if (resultCard) {
              try {
                vars[varKey(card)] = JSON.parse(resultCard.code);
              } catch {
                /* not parseable yet */
              }
            }
          }
        }

        updateCard(card.id, { status: nextStatus });

        logs.push({ time: elapsedOf(), text: logText, type: nextStatus === 'error' ? 'error' : 'success' });
        setExecutionLogs([...logs]);

        if (nextStatus === 'error') {
          setIsRunning(false);
          setLastRunDuration(elapsedOf());
          return;
        }
      }
    }

    const totalElapsed = `${((performance.now() - startTime) / 1000).toFixed(2)}s`;
    setLastRunDuration(totalElapsed);
    setExecutionLogs((prev) => [
      ...prev,
      { time: totalElapsed, text: t('allPassed'), type: 'success' }
    ]);
    setIsRunning(false);
  };

  const handleCopyCode = (card: Card) => {
    navigator.clipboard?.writeText(card.code);
    setCopiedId(card.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // --- PERSISTENCE: {project}/testframe/frames/{name-frame}/{step-id}/{card-id}.md ---
  const saveFrames = async () => {
    try {
      const files = buildFrameFiles(steps);
      const data = await testframeApi.saveFrames(slug(projectName), files);
      pushFrameMsg(t('framesSaved', { n: data.saved, root: data.root }), 'success');
    } catch (err) {
      pushFrameMsg(t('framesSaveFail', { msg: (err as Error).message }), 'error');
    }
  };
  saveFramesRef.current = saveFrames;

  const loadFrames = async () => {
    try {
      const data = await testframeApi.loadFrames(slug(projectName));
      if (!data.files.length) {
        pushFrameMsg(t('noFramesSaved'), 'error');
        return;
      }
      const loaded = rebuildSteps(data.files);
      if (!loaded.steps.length) {
        pushFrameMsg(t('framesInvalid', { msg: loaded.errors[0] || 'unrecognized schema' }), 'error');
        return;
      }
      setSteps(loaded.steps);
      setSelectedCardId(loaded.steps[0]?.preCards[0]?.id ?? loaded.steps[0]?.postCards[0]?.id ?? null);
      pushFrameMsg(
        loaded.errors.length
          ? t('stepsLoadedWarn', { n: loaded.steps.length, m: loaded.errors.length })
          : t('stepsLoaded', { n: loaded.steps.length }),
        loaded.errors.length ? 'error' : 'success'
      );
    } catch (err) {
      pushFrameMsg(t('framesLoadFail', { msg: (err as Error).message }), 'error');
    }
  };

  const apiPort = import.meta.env.VITE_SERVER_PORT ?? '18080';

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#F5F5F7] text-slate-800 select-none font-sans">
      {/* =====================================================================
          1. FIGMA-STYLE TOP BAR (HEADER)
         ===================================================================== */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between z-30 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {/* Left: project icon + editable name + tag */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/90 rounded-lg px-2.5 py-1.5 shadow-xs">
            <div className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              aria-label={t('projectNameLabel')}
              className="font-semibold text-sm text-slate-800 bg-transparent border-none outline-none focus:ring-2 focus:ring-blue-500/30 rounded px-1 w-44 sm:w-52"
            />
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200/70">
              {t('suiteBadge')}
            </span>
          </div>

          {/* Backend connection status (Spring Boot) */}
          <div
            title={
              apiOnline === null ? t('apiCheckingHint') : apiOnline ? t('apiOnlineHint') : t('apiOfflineHint')
            }
            className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border bg-white"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                apiOnline === null
                  ? 'bg-slate-300 animate-pulse'
                  : apiOnline
                  ? 'bg-emerald-500'
                  : 'bg-rose-500'
              }`}
            />
            <span className="text-slate-600 font-mono">
              {apiOnline === null ? t('apiChecking') : apiOnline ? `API :${apiPort}` : t('apiOffline')}
            </span>
          </div>

          {/* Tool selector (cursor / hand) */}
          <div className="hidden md:flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
            <button
              onClick={() => setToolMode('select')}
              title={t('selectTool')}
              className={`p-1.5 rounded-md transition-colors ${
                toolMode === 'select' && !spacePressed
                  ? 'bg-white text-blue-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <MousePointer2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setToolMode('hand')}
              title={t('handTool')}
              className={`p-1.5 rounded-md transition-colors ${
                toolMode === 'hand' || spacePressed
                  ? 'bg-white text-blue-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Hand className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center: Figma-style zoom controls */}
        <div className="flex items-center gap-1.5 bg-slate-100/90 border border-slate-200/80 rounded-lg px-2 py-1">
          <button
            onClick={handleZoomOut}
            title={t('zoomOut')}
            className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-semibold text-slate-700 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            title={t('zoomIn')}
            className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-slate-300 mx-0.5" />
          <button
            onClick={resetViewport}
            title={t('fitView')}
            className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 transition-colors flex items-center gap-1 text-xs font-medium px-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{t('fit')}</span>
          </button>
        </div>

        {/* Right: language, persistence and main actions */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80" role="group" aria-label="Language">
            <button
              onClick={() => setLang('en')}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                lang === 'en' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang('pt-BR')}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                lang === 'pt-BR' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
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
            onClick={() => setSourcesOpen(true)}
            title={t('sourcesHint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98]"
          >
            <Database className="w-3.5 h-3.5 text-purple-600" />
            {t('sources')}
          </button>

          <button
            onClick={loadFrames}
            title={t('loadHint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98]"
          >
            <FolderDown className="w-3.5 h-3.5 text-slate-500" />
            {t('load')}
          </button>

          <button
            onClick={saveFrames}
            title={t('saveFramesHint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98]"
          >
            <Save className="w-3.5 h-3.5 text-emerald-600" />
            {t('saveFrames')}
          </button>

          <button
            onClick={addNewStep}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-2xs active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            {t('newStep')}
          </button>

          <button
            onClick={runFlowSimulation}
            disabled={isRunning}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-sm active:scale-[0.98] ${
              isRunning
                ? 'bg-blue-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
            }`}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
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

      {/* =====================================================================
          2. MAIN AREA: DOTTED INFINITE CANVAS + SIDE INSPECTOR
         ===================================================================== */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* INFINITE CANVAS (WITH PAN AND ZOOM) */}
        <main
          ref={canvasRef}
          onWheel={handleWheel}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          data-canvas-bg="true"
          style={{
            backgroundImage: 'radial-gradient(#CBD5E1 1.25px, transparent 1.25px)',
            backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`
          }}
          className={`flex-1 relative overflow-hidden bg-[#F7F8FA] ${
            isPanning
              ? 'cursor-grabbing'
              : spacePressed || toolMode === 'hand'
              ? 'cursor-grab'
              : 'cursor-default'
          }`}
        >
          {/* Container transformed by pan and zoom */}
          <div
            data-canvas-bg="true"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0'
            }}
            className="inline-flex flex-col gap-7 pb-32 pr-32 transition-transform duration-75 ease-out"
          >
            {/* VERTICAL LIST OF STRUCTURED STEPS (FIXED ORDER) */}
            {steps.map((step) => (
              <StepFrame
                key={step.id}
                step={step}
                totalSteps={steps.length}
                selectedCardId={selectedCardId}
                editingCodeCardId={editingCodeCardId}
                copiedId={copiedId}
                onSelectCard={(id) => setSelectedCardId(id)}
                onStartEditCode={(id) => setEditingCodeCardId(id)}
                onStopEditCode={() => setEditingCodeCardId(null)}
                onUpdateCard={updateCard}
                onStartCardResize={startCardResize}
                onStartSplitResize={startSplitResize}
                onAddCard={addCardToPhase}
                onDeleteCard={deleteCard}
                onDeleteStep={deleteStep}
                onCopyCode={handleCopyCode}
              />
            ))}

            {/* Empty state or "add step" button at the end of the canvas */}
            {steps.length === 0 ? (
              <div className="flex items-center justify-center py-24">
                <div className="flex flex-col items-center gap-3 text-center max-w-sm">
                  <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                    <Sliders className="w-6 h-6 text-blue-600" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">{t('noStepsTitle')}</p>
                  <p className="text-xs text-slate-500 -mt-1">{t('noStepsHint')}</p>
                  <button
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
                  onClick={addNewStep}
                  className="group flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-dashed border-slate-300 bg-white/70 hover:bg-white hover:border-blue-400 text-slate-500 hover:text-blue-600 text-xs font-semibold transition-all shadow-2xs"
                >
                  <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
                  {t('addStepToEnd', { n: steps.length + 1 })}
                </button>
              </div>
            )}
          </div>

          {/* Bottom floating bar: hints and quick execution console */}
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between pointer-events-none z-20">
            <div className="pointer-events-auto bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-lg px-3 py-1.5 text-[11px] text-slate-500 shadow-sm flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono text-slate-700">
                  {t('hintSpaceDrag')}
                </kbd>
                {t('hintMoveCanvas')}
              </span>
              <span className="text-slate-300">|</span>
              <span>{t('hintResize')}</span>
            </div>

            <ExecutionConsole logs={executionLogs} onClear={() => setExecutionLogs([])} />
          </div>
        </main>

        {/* RIGHT SIDE INSPECTOR */}
        <InspectorPanel
          selectedContext={selectedContext}
          sources={sources}
          onUpdateCard={updateCard}
          onDeleteCard={deleteCard}
          onOpenSources={() => setSourcesOpen(true)}
        />

        <SourcesModal
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          project={slug(projectName)}
          sources={sources}
          setSources={setSources}
          onLog={pushFrameMsg}
        />
      </div>
    </div>
  );
}
