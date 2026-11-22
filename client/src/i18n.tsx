import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'en' | 'pt-BR';

const en = {
  // Header
  suiteBadge: 'E2E Suite • Active',
  projectNameLabel: 'Project name',
  frameNameLabel: 'Frame (flow) name',
  selectTool: 'Select & Resize (V)',
  handTool: 'Pan Canvas (Hold Space)',
  zoomOut: 'Zoom out (Ctrl + −)',
  zoomIn: 'Zoom in (Ctrl + +)',
  fitView: 'Center & reset zoom (Ctrl+0)',
  fit: 'Fit',
  sources: 'Sources',
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
  runStopped: 'Run stopped at the first error card.',
  runFail: 'Run failed: {msg}',
  framesSaved: '{n} cards saved to {root}',
  framesSaveFail: 'Failed to save frames: {msg}',
  catalogFail: 'Failed to load the domain catalog from the server: {msg}',
  framesLoadFail: 'Failed to load frames: {msg}',
  noFramesSaved: 'No frames saved in this project yet',
  framesInvalid: 'Invalid frames: {msg}',
  stepsLoaded: 'Flow loaded successfully: {n} steps',
  stepsLoadedWarn: '{n} steps loaded ({m} card files with problems)',

  // Step frame
  stepWord: 'Step',
  blocksOne: '{n} block',
  blocksMany: '{n} blocks',
  deleteStep: 'Delete this step',
  addCard: 'Add card to this step',

  // Card chrome
  copyContent: 'Copy content',
  edit: 'Edit',
  resizeWidth: 'Drag to adjust width',
  resizeHeight: 'Drag to adjust height',
  resizeBoth: 'Drag to resize width and height',

  // Inspector
  stepN: 'Step {n}',
  cardTitleField: 'Card Title',
  endpointField: 'Subtitle / Endpoint',
  dimensions: 'Dimensions (Fixed Layout)',
  presetCompact: 'Compact',
  presetMedium: 'Medium',
  presetExpanded: 'Expanded',
  frameSource: 'Frame Source',
  manageSources: 'Manage sources',
  sourceNamePlaceholder: '— pick a source —',
  timeoutLabel: 'Timeout (ms)',
  resizeResult: 'Drag to resize the last run',
  resultSaveFail: 'Could not store the last run ({path}): {msg}',
  pickProjectHint: 'Pick a project to open or create a new one',
  recentProjects: 'Recent projects',
  otherProjects: 'Other projects',
  allProjects: 'Projects',
  loadingProjects: 'Loading projects…',
  projectsLoadFail: 'Could not list projects: {msg}',
  noMoreProjects: 'No other projects in the projects folder',
  projectStats: '{frames} frame(s) · {sources} source(s) · {when}',
  projectNotOnDisk: 'Not saved yet',
  projectForget: 'Remove from recents',
  projectSuggested: 'runner',
  newProjectPlaceholder: 'new-project-name',
  createProject: 'Create',
  switchProject: 'Switch project',
  runCard: 'Run',
  lastRunResult: 'Last run',
  editCardTitle: 'Edit card',
  close: 'Close',
  codeLabel: 'Code',
  generalSection: 'General',
  sourceFormTitle: '{type} form',
  baseUrlHint: 'Base URL: {url}',
  requestBodyLabel: 'Request body',
  jsonValid: 'Valid JSON',
  jsonInvalid: 'Invalid JSON: {msg}',
  swaggerHint: 'Operation defined by the OpenAPI spec:',
  connectionHint: 'Connection: {url}',
  queryLabel: 'Query',
  codeRuleOk: 'Valid {type} script',
  jsonBodyLabel: 'JSON (supports {{bindings}})',
  tabFrames: 'Frames',
  tabSources: 'Sources',
  privateDataLabel: 'Private data',
  privateDataHint: 'Secrets for this card (saved to .private.md, not versioned)',
  lastRunStatus: 'Last Run Status',
  statusSuccess: 'Success (valid assertion)',
  statusError: 'Execution failed',
  statusRunning: 'Running now...',
  statusIdle: 'Waiting for execution',
  statusSkipped: 'Skipped (a condition before it was false)',
  scriptLinesLabel: 'jsonassert script (one statement per line)',
  scriptHint: 'assert <expr> (==|!=|>|>=|<|<=) <expr> lines and/or expressions; the last expression is the card\'s value',
  scriptLinesOk: '{n} statement(s) well-formed',
  conditionLabel: 'Condition (one boolean jsonassert expression)',
  conditionHint: 'true: the step continues; false: the rest of this step is skipped and the run goes on with the next step',
  conditionOk: 'Valid condition',
  removeBlock: 'Remove Block',

  // Sources modal
  newSource: 'New source',
  noSources: 'No sources registered.',
  read: 'Read',
  save: 'Save',
  deleteSource: 'Delete source',
  privateDataDesc: '(source access details)',
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
  defaultCardTitle: 'New card',
  sourceTypePlaceholder: '— choose the type-source —',
  sourceTypeFirstHint: 'Choose the card\'s type-source first: it decides the source, the form and how the card runs.',

  subtypePlaceholder: '— choose the subtype —',
  subtypeFirstHint: 'Choose the card\'s subtype: it decides the body, the form and how the card runs.',
  operationLabel: 'Operation (from the OpenAPI spec)',
  operationPlaceholder: '— choose an operation —',
  operationsLoading: 'Reading the source\'s operations…',
  operationsFail: 'Could not read the operations: {msg}',
  operationMissing: '{endpoint} is not an operation of this spec',
  operationNeedsSource: 'Choose the name-source: its OpenAPI spec lists the operations.',
  operationMoved: 'The spec moved this operation: {endpoint} is now {current} (pick it again to update)',
  mongoBodyLabel: 'Mongo {subtype} (JSON, supports {{bindings}})',
  collectionRequired: 'Required: the collection the query reads (no $, not system.*)',
  openapiSourceHint: 'base-url is the OpenAPI spec (JSON); saving caches its operations in {name}.cache.md.',
  varNameField: 'Variable name (var-name)'
} as const;

export type TKey = keyof typeof en;

const pt: Record<TKey, string> = {
  suiteBadge: 'Suíte E2E • Ativo',
  projectNameLabel: 'Nome do projeto',
  frameNameLabel: 'Nome do frame (fluxo)',
  selectTool: 'Selecionar e Redimensionar (V)',
  handTool: 'Arrastar Canvas (Segure Espaço)',
  zoomOut: 'Diminuir zoom (Ctrl + −)',
  zoomIn: 'Aumentar zoom (Ctrl + +)',
  fitView: 'Centralizar e Resetar Zoom (Ctrl+0)',
  fit: 'Ajustar',
  sources: 'Sources',
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
  runStopped: 'A execução parou no primeiro card com erro.',
  runFail: 'Falha na execução: {msg}',
  framesSaved: '{n} cards salvos em {root}',
  framesSaveFail: 'Falha ao salvar frames: {msg}',
  catalogFail: 'Falha ao carregar o catálogo do servidor: {msg}',
  framesLoadFail: 'Falha ao carregar frames: {msg}',
  noFramesSaved: 'Nenhum frame salvo neste projeto ainda',
  framesInvalid: 'Frames inválidos: {msg}',
  stepsLoaded: 'Fluxo carregado com sucesso: {n} etapas',
  stepsLoadedWarn: '{n} etapas carregadas ({m} arquivos de card com problemas)',

  stepWord: 'Etapa',
  blocksOne: '{n} bloco',
  blocksMany: '{n} blocos',
  deleteStep: 'Excluir esta etapa',
  addCard: 'Adicionar card a este step',

  copyContent: 'Copiar conteúdo',
  edit: 'Editar',
  resizeWidth: 'Arraste para ajustar a largura',
  resizeHeight: 'Arraste para ajustar a altura',
  resizeBoth: 'Arraste para redimensionar largura e altura',

  stepN: 'Etapa {n}',
  cardTitleField: 'Título do Card',
  endpointField: 'Subtítulo / Endpoint',
  dimensions: 'Dimensões (Layout Fixo)',
  presetCompact: 'Compacto',
  presetMedium: 'Médio',
  presetExpanded: 'Expandido',
  frameSource: 'Source do Frame',
  manageSources: 'Gerenciar sources',
  sourceNamePlaceholder: '— escolha uma source —',
  timeoutLabel: 'Timeout (ms)',
  resizeResult: 'Arraste para redimensionar a última execução',
  resultSaveFail: 'Não foi possível guardar a última execução ({path}): {msg}',
  pickProjectHint: 'Escolha um projeto para abrir ou crie um novo',
  recentProjects: 'Projetos recentes',
  otherProjects: 'Outros projetos',
  allProjects: 'Projetos',
  loadingProjects: 'Carregando projetos…',
  projectsLoadFail: 'Não foi possível listar os projetos: {msg}',
  noMoreProjects: 'Nenhum outro projeto na pasta de projetos',
  projectStats: '{frames} frame(s) · {sources} source(s) · {when}',
  projectNotOnDisk: 'Ainda não salvo',
  projectForget: 'Remover dos recentes',
  projectSuggested: 'runner',
  newProjectPlaceholder: 'nome-do-novo-projeto',
  createProject: 'Criar',
  switchProject: 'Trocar de projeto',
  runCard: 'Executar',
  lastRunResult: 'Última execução',
  editCardTitle: 'Editar card',
  close: 'Fechar',
  codeLabel: 'Código',
  generalSection: 'Geral',
  sourceFormTitle: 'Formulário {type}',
  baseUrlHint: 'URL base: {url}',
  requestBodyLabel: 'Corpo da requisição',
  jsonValid: 'JSON válido',
  jsonInvalid: 'JSON inválido: {msg}',
  swaggerHint: 'Operação definida pela spec OpenAPI:',
  connectionHint: 'Conexão: {url}',
  queryLabel: 'Query',
  codeRuleOk: 'Script {type} válido',
  jsonBodyLabel: 'JSON (aceita {{bindings}})',
  tabFrames: 'Frames',
  tabSources: 'Sources',
  privateDataLabel: 'Dados privados',
  privateDataHint: 'Segredos deste card (salvos em .private.md, fora do versionamento)',
  lastRunStatus: 'Status da Última Execução',
  statusSuccess: 'Sucesso (Asserção Válida)',
  statusError: 'Falha na Execução',
  statusRunning: 'Executando agora...',
  statusIdle: 'Aguardando execução',
  statusSkipped: 'Pulado (uma condição antes dele foi falsa)',
  scriptLinesLabel: 'Script jsonassert (uma instrução por linha)',
  scriptHint: 'linhas assert <expr> (==|!=|>|>=|<|<=) <expr> e/ou expressões; a última expressão é o valor do card',
  scriptLinesOk: '{n} instrução(ões) bem formada(s)',
  conditionLabel: 'Condição (uma expressão jsonassert booleana)',
  conditionHint: 'true: o step continua; false: o resto deste step é pulado e a execução segue no próximo step',
  conditionOk: 'Condição válida',
  removeBlock: 'Remover Bloco',

  newSource: 'Nova source',
  noSources: 'Nenhuma source cadastrada.',
  read: 'Ler',
  save: 'Salvar',
  deleteSource: 'Excluir source',
  privateDataDesc: '(detalhes de acesso do source)',
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
  defaultCardTitle: 'Novo card',
  sourceTypePlaceholder: '— escolha o type-source —',
  sourceTypeFirstHint: 'Escolha primeiro o type-source do card: ele define a source, o formulário e como o card executa.',

  subtypePlaceholder: '— escolha o subtype —',
  subtypeFirstHint: 'Escolha o subtype do card: ele decide o corpo, o formulário e como o card roda.',
  operationLabel: 'Operação (da spec OpenAPI)',
  operationPlaceholder: '— escolha uma operação —',
  operationsLoading: 'Lendo as operações da source…',
  operationsFail: 'Não foi possível ler as operações: {msg}',
  operationMissing: '{endpoint} não é uma operação desta spec',
  operationNeedsSource: 'Escolha a name-source: a spec OpenAPI dela lista as operações.',
  operationMoved: 'A spec moveu esta operação: {endpoint} agora é {current} (escolha de novo para atualizar)',
  mongoBodyLabel: 'Mongo {subtype} (JSON, aceita {{bindings}})',
  collectionRequired: 'Obrigatório: a collection que a query lê (sem $, não system.*)',
  openapiSourceHint: 'base-url é a spec OpenAPI (JSON); salvar guarda as operações em {name}.cache.md.',
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
