import * as CardCodec from './card-codec';
import * as CodeRules from './code-rules';
import { FormatError } from './errors';
import * as MdEnvelope from './md-envelope';
import * as Names from './names';
import type { Card, CardRun, Frame, FramesResponse, ProjectFile, Step } from './types';

// A frame directory: {frame}/step-{n}/{var-file}.md cards, the per-step flow.md that maps the
// card sequence, and the private notes {var-file}.private.md (agents/specs/project-format.md).
// Paths are relative to testframe/frames/. Last runs are not project files: they come from the
// IDE build cache, keyed by card base ({frame}/step-{n}/{var-file}).

/** Name of the per-step sequence file: lists the card file names in execution order. */
export const FLOW_FILE = 'flow.md';

const CARD_PATH = /^([a-z0-9][a-z0-9-]*)\/step-(\d{1,9})\/([a-z0-9][a-z0-9-]*)\.md$/;
const PRIVATE_PATH = /^([a-z0-9][a-z0-9-]*\/step-\d+\/[a-z0-9][a-z0-9-]*)\.private\.md$/;
const FLOW_PATH = /^([a-z0-9][a-z0-9-]*)\/step-(\d{1,9})\/flow\.md$/;

/** Files of one frame directory (`dir` = slug of the frame name). */
export interface Written {
  dir: string;
  files: ProjectFile[];
}

interface Entry {
  fileBase: string;
  card: Card;
}

export const dirOf = (frameName: string): string => Names.slug(frameName);

/** `{frame}/step-{n}/{var-file}` (no extension) of a card. */
export const cardBase = (frameName: string, stepNumber: number, varName: string): string =>
  `${dirOf(frameName)}/step-${stepNumber}/${Names.varNameToFileName(varName)}`;

/** Var-name of a card: its own, or derived from its title. */
export const varNameOf = (card: Card): string => (card.varName ? card.varName : Names.toVarName(card.title));

/**
 * Serializes one frame. Steps are numbered by position and each step gets a flow.md listing its
 * card files in order. Throws FormatError when a var-name cannot be stored (duplicate in the
 * frame, lost by the kebab-case file name, or `flow`) or when a card would not load back.
 */
export function write(frame: Frame): Written {
  const dir = dirOf(frame.name);
  const issues: string[] = [];
  const seen = new Map<string, string>();
  const files: ProjectFile[] = [];
  const steps = frame.steps ?? [];
  steps.forEach((step, s) => {
    const cards = step?.cards ?? [];
    const flow: string[] = [];
    const stepFiles: ProjectFile[] = [];
    for (const card of cards) {
      const varName = varNameOf(card);
      const where = `step ${s + 1} "${card.title}"`;
      if (!Names.isRoundTrip(varName)) {
        issues.push(`var-name "${varName}" cannot be stored; use "${Names.normalizeVarName(varName)}"`);
        continue;
      }
      const fileBase = Names.varNameToFileName(varName);
      if (fileBase === 'flow') {
        issues.push('var-name "flow" is reserved by the step sequence file; use another name');
        continue;
      }
      if (seen.has(varName)) {
        issues.push(`var-name "${varName}" is used twice (${seen.get(varName)} and ${where})`);
        continue;
      }
      seen.set(varName, where);
      const content = CardCodec.render({ ...card, varName });
      const problems = CardCodec.validate(MdEnvelope.parse(content).fields);
      const codeProblem = CodeRules.problem(card.sourceType, card.subtype, card.code);
      if (codeProblem !== null) problems.push(`code: ${codeProblem}`);
      if (problems.length) {
        problems.forEach((p) => issues.push(`${where}: ${p}`));
        continue;
      }
      const base = `${dir}/step-${s + 1}/${fileBase}`;
      stepFiles.push({ path: base + CardCodec.CARD_SUFFIX, content });
      if (!Names.isBlank(card.privateData)) {
        stepFiles.push({ path: base + CardCodec.PRIVATE_SUFFIX, content: CardCodec.renderPrivate(card.privateData) });
      }
      flow.push(fileBase);
    }
    // An empty step keeps its folder through an empty flow.md.
    files.push({ path: `${dir}/step-${s + 1}/${FLOW_FILE}`, content: MdEnvelope.renderBody(flow.join('\n')) });
    files.push(...stepFiles);
  });
  if (issues.length) throw new FormatError(issues);
  return { dir, files };
}

/**
 * Groups the files under frames/ into frames and steps. Each step's flow.md gives the card
 * sequence; cards it does not list are appended (file-name order) and reported. Invalid files are
 * reported in `errors` and skipped. `results` holds last runs by card base.
 */
export function read(files: ProjectFile[], results: Map<string, CardRun> = new Map()): FramesResponse {
  const errors: string[] = [];
  const privates = new Map<string, string>();
  const flows = new Map<string, string[]>();
  const cardFiles: ProjectFile[] = [];
  for (const file of files) {
    const fl = FLOW_PATH.exec(file.path);
    if (fl) {
      flows.set(`${fl[1]}/step-${Number(fl[2])}`, flowEntries(file));
      continue;
    }
    const m = PRIVATE_PATH.exec(file.path);
    if (!m) {
      cardFiles.push(file);
      continue;
    }
    privates.set(m[1]!, CardCodec.parsePrivate(file.content));
  }

  const byFrame = new Map<string, Map<number, Entry[]>>();
  const stepsOf = (frame: string) => {
    let steps = byFrame.get(frame);
    if (!steps) byFrame.set(frame, (steps = new Map()));
    return steps;
  };
  const entriesOf = (frame: string, number: number) => {
    const steps = stepsOf(frame);
    let entries = steps.get(number);
    if (!entries) steps.set(number, (entries = []));
    return entries;
  };
  const claimed = new Set<string>();
  for (const file of cardFiles) {
    const m = CARD_PATH.exec(file.path);
    if (!m) {
      errors.push(`${file.path}: path must be {frame}/step-{n}/{var-name}.md`);
      continue;
    }
    const parsed = CardCodec.parse(m[3]!, file.content);
    if (parsed.errors.length) {
      errors.push(`${file.path}: ${parsed.errors.join('; ')}`);
      continue;
    }
    parsed.warnings.forEach((w) => errors.push(`${file.path}: ${w}`));
    const base = file.path.slice(0, -CardCodec.CARD_SUFFIX.length);
    const priv = privates.get(base);
    if (priv !== undefined) claimed.add(base);
    const card: Card = { ...parsed.card!, privateData: priv ?? null, lastRun: results.get(base) ?? null };
    entriesOf(m[1]!, Number(m[2])).push({ fileBase: m[3]!, card });
  }
  for (const base of privates.keys()) {
    if (!claimed.has(base)) errors.push(`${base}: private data without a card (${base}.md missing)`);
  }

  // A flow.md without card files is an empty step.
  for (const key of flows.keys()) {
    const slash = key.indexOf('/step-');
    entriesOf(key.slice(0, slash), Number(key.slice(slash + 6)));
  }

  const frames: Frame[] = [];
  for (const name of [...byFrame.keys()].sort(compareStrings)) {
    const stepsByNumber = byFrame.get(name)!;
    const steps: Step[] = [];
    for (const number of [...stepsByNumber.keys()].sort((a, b) => a - b)) {
      const ordered = orderStep(name, number, stepsByNumber.get(number)!, flows.get(`${name}/step-${number}`), errors);
      steps.push({ number: steps.length + 1, cards: ordered.map((e) => e.card) });
    }
    frames.push({ name, steps });
  }
  return { frames, errors };
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byFileBase = (a: Entry, b: Entry) => compareStrings(a.fileBase, b.fileBase);

/** The card file names listed in a flow.md body, in order. */
function flowEntries(file: ProjectFile): string[] {
  return MdEnvelope.parse(file.content)
    .body.split(/\r\n|[\n\u000B\f\r\u0085\u2028\u2029]/)
    .map((line) => line.trim().replace(/\.md$/, ''))
    .filter(Boolean);
}

/** Sorts a step's cards by its flow.md, reporting mismatches. */
function orderStep(frame: string, step: number, entries: Entry[], flow: string[] | undefined, errors: string[]): Entry[] {
  if (!flow) return [...entries].sort(byFileBase);
  const byBase = new Map(entries.map((e) => [e.fileBase, e]));
  const ordered: Entry[] = [];
  const listed = new Set<string>();
  for (const name of flow) {
    const entry = byBase.get(name);
    if (!entry) {
      errors.push(`${frame}/step-${step}/${FLOW_FILE}: ${name}.md is listed but the card file is missing`);
      continue;
    }
    if (listed.has(name)) {
      errors.push(`${frame}/step-${step}/${FLOW_FILE}: ${name}.md is listed twice`);
      continue;
    }
    listed.add(name);
    ordered.push(entry);
  }
  for (const e of entries.filter((e) => !listed.has(e.fileBase)).sort(byFileBase)) {
    errors.push(`${frame}/step-${step}/${e.fileBase}.md: not listed in ${FLOW_FILE}`);
    ordered.push(e);
  }
  return ordered;
}
