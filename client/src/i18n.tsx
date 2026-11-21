import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'en' | 'pt-BR';

const en = {
  // Header
  suiteBadge: 'E2E Suite • Active',
  projectNameLabel: 'Project name',
  selectTool: 'Select & Resize (V)',
  handTool: 'Pan Canvas (Hold Space)',
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  fitView: 'Center & reset zoom (Ctrl+0)',
  fit: 'Fit',
  sources: 'Sources',
  sourcesHint: 'Manage project sources (/sources/{type-source}/{name-source})',
  load: 'Load',
  loadHint: 'Load .md frames saved in the project folder',
  saveFrames: 'Save Frames',
  saveFramesHint: 'Save each frame as .md in the project (Ctrl+S)',
  newStep: 'New Step',
  runFlow: 'Run Flow',
  running: 'Running...',
  apiChecking: 'API...',
  apiOffline: 'API offline',
  apiCheckingHint: 'Checking API...',
  apiOnlineHint: 'TestFrame API online',
  apiOfflineHint: 'API offline — start with: bun run example',

  // Canvas
  hintSpaceDrag: 'Space + Drag',
  hintMoveCanvas: 'Move canvas',
  hintResize: 'Drag the card edges to resize',
  addStepToEnd: 'Add Step {n} to Flow',
  consoleTitle: 'Execution Log',
  clear: 'Clear',
  suiteStarting: 'Starting suite "{name}"...',
  allPassed: 'All scenarios passed successfully!',
  logOk: 'OK',
  logAssertFail: 'FAILED assertion',
  logStep: '[Step {n}]',
  framesSaved: '{n} frames saved to {root}',
  framesSaveFail: 'Failed to save frames: {msg}',
  framesLoadFail: 'Failed to load frames: {msg}',
  noFramesSaved: 'No frames saved in this project yet',
  framesInvalid: 'Invalid frames: {msg}',
  stepsLoaded: 'Flow loaded successfully: {n} steps',
  stepsLoadedWarn: '{n} steps loaded ({m} frames skipped due to invalid schema)',

  // Step frame
  stepWord: 'Step',
  blocksOne: '{n} block',
  blocksMany: '{n} blocks',
  assertsOne: '{n} assertion',
  assertsMany: '{n} assertions',
  deleteStep: 'Delete this step',
  addCardPre: 'Add card to Pre-Execution',
  addCardPost: 'Add card / assertion to Post-Execution',
  splitHint: 'Drag to adjust width between Pre and Post-Execution',

  // Card chrome
  copyContent: 'Copy content',
  edit: 'Edit',
  done: 'Done',
  resizeWidth: 'Drag to adjust width',
  resizeHeight: 'Drag to adjust height',
  resizeBoth: 'Drag to resize width and height',

  // Inspector
  blockInspector: 'Block Inspector',
  stepN: 'Step {n}',
  blockLayer: 'Block Layer',
  phasePre: 'PRE-EXECUTION',
  phasePost: 'POST-EXECUTION',
  cardTitleField: 'Card Title',
  endpointField: 'Subtitle / Endpoint',
  dimensions: 'Dimensions (Fixed Layout)',
  presetCompact: 'Compact',
  presetMedium: 'Medium',
  presetExpanded: 'Expanded',
  blockType: 'Block Type',
  typeRequest: 'API Request',
  typeScript: 'Script / SQL',
  typeJson: 'JSON Payload',
  typeValidation: 'Validation',
  frameSource: 'Frame Source',
  manageSources: 'Manage sources',
  sourceNamePlaceholder: 'e.g.: framework-echo-api',
  timeoutLabel: 'Timeout (ms)',
  lastRunStatus: 'Last Run Status',
  statusSuccess: 'Success (valid assertion)',
  statusError: 'Execution failed',
  statusRunning: 'Running now...',
  statusIdle: 'Waiting for execution',
  removeBlock: 'Remove Block',
  noBlockSelected: 'No block selected',
  noBlockHint: 'Click any card on the canvas to inspect and adjust its dimensions.',

  // Sources modal
  newSource: 'New source',
  noSources: 'No sources registered.',
  read: 'Read',
  save: 'Save',
  deleteSource: 'Delete source',
  publicDataDesc: '(schema, routes, tables — shareable)',
  privateDataDesc: '(source access details)',
  publicPlaceholder: '# Source name\n\nData schema, endpoints, columns...',
  privatePlaceholder: '# Access\n\nHost, port, user...',
  createFirst: 'Create a source to get started.',
  savedSources: '{n} source files written to {root}',
  savedSourcesFail: 'Failed to save sources: {msg}',
  loadedSources: '{n} sources loaded from the project',
  noSavedSources: 'No sources saved in this project yet',
  loadedSourcesFail: 'Failed to load sources: {msg}',

  // Empty canvas and card defaults
  noStepsTitle: 'No steps in this flow yet',
  noStepsHint: 'Add a step to start composing your E2E flow.',
  runEmpty: 'Nothing to run — add a step first.',
  defaultRequestTitle: 'New Action / Request',
  defaultAssertionTitle: 'New JSON Assertion',
  defaultJsonResultTitle: 'JSON Result',
  defaultSchemaEndpoint: 'Validation Schema',
  defaultStepTitle: 'Run validation on step {n}',

  // Scripts editor (sources scripts/{name}.md)
  addScript: 'Add script',
  removeScript: 'Remove script',
  scriptsHint: 'One file per custom query: scripts/{name}.md',
  noScripts: 'No scripts on this source.',
  varNameField: 'Variable name (var-name)'
} as const;

export type TKey = keyof typeof en;

const pt: Record<TKey, string> = {
  suiteBadge: 'Suíte E2E • Ativo',
  projectNameLabel: 'Nome do projeto',
  selectTool: 'Selecionar e Redimensionar (V)',
  handTool: 'Arrastar Canvas (Segure Espaço)',
  zoomOut: 'Diminuir Zoom',
  zoomIn: 'Aumentar Zoom',
  fitView: 'Centralizar e Resetar Zoom (Ctrl+0)',
  fit: 'Ajustar',
  sources: 'Sources',
  sourcesHint: 'Gerenciar sources do projeto (sources/{type-source}/{name-source})',
  load: 'Carregar',
  loadHint: 'Carregar frames .md salvos na pasta do projeto',
  saveFrames: 'Salvar Frames',
  saveFramesHint: 'Salvar cada frame como .md no projeto (Ctrl+S)',
  newStep: 'Nova Etapa',
  runFlow: 'Executar Fluxo',
  running: 'Executando...',
  apiChecking: 'API...',
  apiOffline: 'API offline',
  apiCheckingHint: 'Verificando API...',
  apiOnlineHint: 'API do TestFrame online',
  apiOfflineHint: 'API offline — inicie com: bun run example',

  hintSpaceDrag: 'Espaço + Arrastar',
  hintMoveCanvas: 'Mover canvas',
  hintResize: 'Arraste as bordas dos cards para redimensionar',
  addStepToEnd: 'Adicionar Etapa {n} ao Fluxo',
  consoleTitle: 'Log de Execução',
  clear: 'Limpar',
  suiteStarting: 'Iniciando suíte "{name}"...',
  allPassed: 'Todos os cenários passaram com sucesso!',
  logOk: 'OK',
  logAssertFail: 'FALHOU na asserção',
  logStep: '[Etapa {n}]',
  framesSaved: '{n} frames salvos em {root}',
  framesSaveFail: 'Falha ao salvar frames: {msg}',
  framesLoadFail: 'Falha ao carregar frames: {msg}',
  noFramesSaved: 'Nenhum frame salvo neste projeto ainda',
  framesInvalid: 'Frames inválidos: {msg}',
  stepsLoaded: 'Fluxo carregado com sucesso: {n} etapas',
  stepsLoadedWarn: '{n} etapas carregadas ({m} frames ignorados por schema inválido)',

  stepWord: 'Etapa',
  blocksOne: '{n} bloco',
  blocksMany: '{n} blocos',
  assertsOne: '{n} asserção',
  assertsMany: '{n} asserções',
  deleteStep: 'Excluir esta etapa',
  addCardPre: 'Adicionar card na Pré-Execução',
  addCardPost: 'Adicionar card / asserção na Pós-Execução',
  splitHint: 'Arraste para ajustar a largura entre Pré e Pós-Execução',

  copyContent: 'Copiar conteúdo',
  edit: 'Editar',
  done: 'Concluir',
  resizeWidth: 'Arraste para ajustar a largura',
  resizeHeight: 'Arraste para ajustar a altura',
  resizeBoth: 'Arraste para redimensionar largura e altura',

  blockInspector: 'Inspetor de Bloco',
  stepN: 'Etapa {n}',
  blockLayer: 'Camada / Bloco',
  phasePre: 'PRE-EXECUÇÃO',
  phasePost: 'PÓS-EXECUÇÃO',
  cardTitleField: 'Título do Card',
  endpointField: 'Subtítulo / Endpoint',
  dimensions: 'Dimensões (Layout Fixo)',
  presetCompact: 'Compacto',
  presetMedium: 'Médio',
  presetExpanded: 'Expandido',
  blockType: 'Tipo do Bloco',
  typeRequest: 'Request API',
  typeScript: 'Script / SQL',
  typeJson: 'Payload JSON',
  typeValidation: 'Validação',
  frameSource: 'Source do Frame',
  manageSources: 'Gerenciar sources',
  sourceNamePlaceholder: 'ex.: framework-echo-api',
  timeoutLabel: 'Timeout (ms)',
  lastRunStatus: 'Status da Última Execução',
  statusSuccess: 'Sucesso (Asserção Válida)',
  statusError: 'Falha na Execução',
  statusRunning: 'Executando agora...',
  statusIdle: 'Aguardando execução',
  removeBlock: 'Remover Bloco',
  noBlockSelected: 'Nenhum bloco selecionado',
  noBlockHint: 'Clique em qualquer card no canvas para inspecionar e ajustar suas dimensões.',

  newSource: 'Nova source',
  noSources: 'Nenhuma source cadastrada.',
  read: 'Ler',
  save: 'Salvar',
  deleteSource: 'Excluir source',
  publicDataDesc: '(esquema, rotas, tabelas — compartilhável)',
  privateDataDesc: '(detalhes de acesso do source)',
  publicPlaceholder: '# Nome da source\n\nEsquema de dados, endpoints, colunas...',
  privatePlaceholder: '# Acesso\n\nHost, porta, usuário...',
  createFirst: 'Crie uma source para começar.',
  savedSources: '{n} arquivos de source gravados em {root}',
  savedSourcesFail: 'Falha ao salvar sources: {msg}',
  loadedSources: '{n} sources carregadas do projeto',
  noSavedSources: 'Nenhuma source salva neste projeto ainda',
  loadedSourcesFail: 'Falha ao carregar sources: {msg}',

  noStepsTitle: 'Nenhuma etapa neste fluxo ainda',
  noStepsHint: 'Adicione uma etapa para começar a compor seu fluxo E2E.',
  runEmpty: 'Nada para executar — adicione uma etapa primeiro.',
  defaultRequestTitle: 'Nova Ação / Request',
  defaultAssertionTitle: 'Nova Asserção JSON',
  defaultJsonResultTitle: 'Resultado em JSON',
  defaultSchemaEndpoint: 'Validação Schema',
  defaultStepTitle: 'Executar validação na etapa {n}',

  addScript: 'Adicionar script',
  removeScript: 'Remover script',
  scriptsHint: 'Um arquivo por query custom: scripts/{name}.md',
  noScripts: 'Nenhum script nesta source.',
  varNameField: 'Nome da variável (var-name)'
};

const dictionaries: Record<Lang, Record<TKey, string>> = { en, 'pt-BR': pt };

export interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = '***';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'pt-BR' ? 'pt-BR' : 'en'
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
  }, [lang]);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      let text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
