export type CardType = 'request' | 'script' | 'json' | 'validation';
export type CardStatus = 'idle' | 'running' | 'success' | 'error';
export type PhaseKey = 'preCards' | 'postCards';
export type ResizeDirection = 'right' | 'bottom' | 'corner';
export type LogLevel = 'info' | 'success' | 'error';

export interface Card {
  id: string;
  title: string;
  varName?: string; // camelCase variable produced by this card (file name derives from it)
  type: CardType;
  width: number;
  height: number;
  timeout: number;
  status: CardStatus;
  endpoint: string;
  code: string;
  sourceType: string;
  sourceName: string;
  httpMethod: string;
}

export interface Step {
  id: string;
  number: number;
  splitRatio: number;
  preCards: Card[];
  postCards: Card[];
}

export interface SourceScript {
  name: string; // camelCase, e.g. obterProdutosAtivos -> scripts/obter-produtos-ativos.md
  body: string; // the query/code itself
}

// Shape sent to POST /api/v2/sources after wrapping
export interface ScriptFile {
  file: string; // kebab-case file name, e.g. obter-produtos-ativos.md
  content: string; // full .md (frontmatter + body)
}

export interface SourceDef {
  typeSource: string;
  name: string;
  baseUrl?: string;
  publicData: string;
  privateData: string;
  scripts?: SourceScript[]; // custom queries; swagger sources rely on the spec instead
}

// Shape received from GET /api/v2/sources/{project}
export interface RawSource {
  typeSource: string;
  name: string;
  publicData: string;
  privateData: string;
  scripts?: ScriptFile[];
}

export type WrappedSource = Omit<SourceDef, 'scripts'> & { scripts: ScriptFile[] };

export interface ExecLog {
  time: string;
  text: string;
  type: LogLevel;
}

export interface HttpResult {
  ok: boolean;
  status: number;
  statusText: string;
  ms: number;
  text: string;
}

export interface FrameFile {
  path: string;
  content: string;
}

export interface EndpointParts {
  method: string;
  path: string;
}

export interface SelectedContext {
  card: Card;
  stepId: string;
  stepNumber: number;
  phaseKey: PhaseKey;
}

export interface FramesSaveResponse {
  project: string;
  root: string;
  saved: number;
}

export interface FramesLoadResponse {
  project: string;
  root: string;
  files: FrameFile[];
}
