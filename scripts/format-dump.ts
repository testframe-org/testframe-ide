// The TypeScript side of the format parity gate: prints the IDE's view of one project as the
// canonical JSON defined by the gate (repo-root `scripts/format-check.ts`), which compares it with
// the plugin's read-only decoders (`java -jar testframe-plugin-spring.jar format-dump`). Module
// responsibility: the project arrives as a parameter, this script never reads the root config.
//
// Usage: bun scripts/format-dump.ts --projectDir=<abs dir>
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import * as Catalog from '../lib/format/catalog';
import * as FrameCodec from '../lib/format/frame-codec';
import type { Card } from '../lib/format/types';
import * as Sources from '../lib/sources/sources-yaml';
import { FRAMES_DIR, ProjectStore, TESTFRAME_DIR } from '../lib/store/project-store';
import { parseFlags } from './args';

/** The dump format both sides produce; bump it when the canonical shape changes. */
export const FORMAT = 1;

/** Stands in for a resolved value whose winning layer is a `.private.yaml` file. */
export const PRIVATE = '<private>';

/** One card in the canonical projection (see the gate for the shape and the normalizations). */
export interface DumpCard {
  varName: string | null;
  title: string | null;
  type: string;
  sourceType: string | null;
  sourceName: string | null;
  subtype: string | null;
  collection: string | null;
  endpoint: string | null;
  openapiId: string | null;
  timeout: number;
  code: string;
}

/** One source resolved in one environment; a private value is never printed. */
export interface DumpSource {
  ref: string;
  baseUrl: string;
  configured: boolean;
  headers: Record<string, string>;
  privateFields: string[];
}

export interface Dump {
  format: number;
  project: string;
  frames: { name: string; steps: { number: number; cards: DumpCard[] }[] }[];
  frameProblems: string[];
  sources: {
    environments: string[];
    declared: string[];
    problems: string[];
    resolved: { environment: string; sources: DumpSource[] }[];
  };
}

/** An absent field and an empty one are both dumped as null (the Java decoders read null). */
const text = (value: string | null | undefined): string | null => (!value ? null : value);

const sorted = (values: string[]): string[] => [...values].sort();

function cardOf(card: Card): DumpCard {
  const type = Catalog.cardTypeOf(card.sourceType, card.subtype);
  return {
    varName: text(card.varName),
    title: text(card.title),
    type,
    sourceType: text(card.sourceType),
    sourceName: text(card.sourceName),
    subtype: text(card.subtype),
    collection: text(card.collection),
    endpoint: text(card.endpoint),
    openapiId: text(card.openapiId),
    // a card file without timeout means the card type's default (the plugin derives the same)
    timeout: typeof card.timeout === 'number' ? card.timeout : Catalog.defaultTimeout(type),
    code: card.code ?? ''
  };
}

function resolvedOf(source: Sources.ResolvedSource): DumpSource {
  const privateFields = new Set(source.privateFields);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(source.headers)) {
    headers[name] = privateFields.has(`headers.${name}`) ? PRIVATE : value;
  }
  return {
    ref: source.ref,
    baseUrl: privateFields.has('base-url') ? PRIVATE : source.baseUrl ?? '',
    configured: source.configured,
    headers,
    privateFields: source.privateFields
  };
}

/**
 * The canonical view of one project: its frames (cards in flow order, an invalid card dropped and
 * reported, as both readers do) and its sources (every environment resolved). Layout fields,
 * private notes and last runs are not part of the format parity; resolved values from a private
 * layer are masked, and the secrets each side derives are not dumped (the plugin owns redaction).
 */
export async function dumpProject(projectDir: string): Promise<Dump> {
  const dir = resolve(projectDir);
  const project = basename(dir);
  const store = new ProjectStore(dirname(dir));

  const { files, errors: readErrors } = await store.list(project, FRAMES_DIR);
  // the plugin never reads a card's private notes, so they are out of the parity (and out of the
  // way of a local editor's drafts): the projection holds no private data either
  const read = FrameCodec.read(files.filter((f) => !f.path.endsWith('.private.md')));
  const frames = read.frames.map((frame) => ({
    name: frame.name,
    steps: (frame.steps ?? []).map((step) => ({
      number: step.number ?? 0,
      cards: (step.cards ?? []).map(cardOf)
    }))
  }));

  const { layers, errors: layerErrors } = await store.readSourceLayers(project);
  const { model, errors } = Sources.readModel(layers);
  const resolved = errors.length
    ? []
    : model.environments.map((environment) => ({
        environment,
        sources: [...Sources.resolve(model, environment).values()].map(resolvedOf)
      }));

  return {
    format: FORMAT,
    project,
    frames,
    frameProblems: sorted([...readErrors, ...read.errors]),
    sources: {
      environments: model.environments,
      declared: Sources.declaredRefs(model),
      problems: sorted([...layerErrors, ...errors]),
      resolved
    }
  };
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2));
  const projectDir = resolve(flags.require('projectDir'));
  if (!existsSync(resolve(projectDir, TESTFRAME_DIR))) {
    console.error(`format-dump: ${projectDir} is not a project (no ${TESTFRAME_DIR}/ folder)`);
    process.exit(2);
  }
  console.log(JSON.stringify(await dumpProject(projectDir), null, 2));
}
