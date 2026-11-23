// Naming rules of a project (agents/specs/project-format.md). Var-names are camelCase and live on disk
// as their kebab-case file name (getActiveProducts <-> get-active-products.md), so a name is
// storable only when it survives that round trip (no consecutive capitals).

const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
/** Source names: `[a-z0-9][a-z0-9_-]*`, at least 2 characters. */
const SOURCE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
/** Environment names: kebab-case; `private` is reserved. */
const ENV_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRAME_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Lowercase kebab-case without accents, e.g. "Ação rápida" -> "acao-rapida"; empty -> "unnamed". */
export function slug(text: unknown): string {
  const s = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'unnamed';
}

/** Variable name (camelCase) from a human title, e.g. "Get active products" -> getActiveProducts. */
export function toVarName(text: unknown): string {
  return slug(text)
    .split('-')
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join('');
}

/** Kebab-case file name (no extension) of a var-name: getActiveProducts -> get-active-products. */
export function varNameToFileName(varName: unknown): string {
  const s = String(varName ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
  return s || 'card';
}

/** Reverse of varNameToFileName: get-active-products(.md) -> getActiveProducts. */
export const fileNameToVarName = (fileName: string): string => toVarName(fileName.replace(/\.md$/, ''));

/** Coerces input into a var-name that survives the file-name round trip: "getHTTP data" -> getHttpData. */
export const normalizeVarName = (input: string): string => fileNameToVarName(varNameToFileName(input));

export const isRoundTrip = (name: string): boolean => normalizeVarName(name) === name;

/** Problem with a camelCase name (var-name), or null when it is storable. */
export function camelNameProblem(what: string, name: string | null | undefined): string | null {
  if (!name || name.length < 2) return `${what} too short`;
  if (!CAMEL.test(name)) return `${what} must be camelCase`;
  if (!isRoundTrip(name)) return `${what} must survive the kebab-case file name (no consecutive capitals)`;
  return null;
}

/**
 * Why a source name is not storable, as a stable code. The rule lives here once; the message of
 * {@link sourceNameProblem} (part of the format, matched by the plugin's decoders) and the editor's
 * localized copy (editor/i18n.tsx) are both derived from it, so the UI never parses a message.
 */
export type SourceNameProblem = 'too-short' | 'invalid-characters';

/** Problem code of a source name (a key under its type in sources.yaml), or null. */
export function sourceNameProblemCode(name: string | null | undefined): SourceNameProblem | null {
  if (!name || name.length < 2) return 'too-short';
  if (!SOURCE_NAME.test(name)) return 'invalid-characters';
  return null;
}

/** Problem with a source name (a key under its type in sources.yaml), or null. */
export function sourceNameProblem(name: string | null | undefined): string | null {
  switch (sourceNameProblemCode(name)) {
    case 'too-short':
      return 'name too short';
    case 'invalid-characters':
      return 'use lowercase letters, digits, hyphen and underscore (starting with a letter or digit)';
    default:
      return null;
  }
}

/** Why an environment name is not usable, as a stable code (see {@link SourceNameProblem}). */
export type EnvironmentNameProblem = 'invalid' | 'reserved';

/** Problem code of an environment name, or null. */
export function environmentNameProblemCode(name: unknown): EnvironmentNameProblem | null {
  if (typeof name !== 'string' || !ENV_NAME.test(name)) return 'invalid';
  if (name === 'private') return 'reserved';
  return null;
}

/** Problem with an environment name, or null. */
export function environmentNameProblem(name: unknown): string | null {
  switch (environmentNameProblemCode(name)) {
    case 'invalid':
      return `invalid environment name ${JSON.stringify(name)} (kebab-case: [a-z0-9]+(-[a-z0-9]+)*)`;
    case 'reserved':
      return 'the environment name "private" is reserved';
    default:
      return null;
  }
}

export const isFrameDirName = (name: string): boolean => FRAME_NAME.test(name);

/** String.prototype.trim of a possibly missing value. */
export const trim = (text: string | null | undefined): string => (text ?? '').trim();

export const isBlank = (text: string | null | undefined): boolean => trim(text) === '';
