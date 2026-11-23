import type { EnvLayers, LayerData, SourceFields, SourcesModel } from './sources-yaml';

// Renaming a declared source, shared by both sides of the sources API: the editor renames the
// masked model it holds, and a save applies the same renames to the model read from disk so the
// source's stored private values answer the markers sent under its new name. A module of its own
// (like private-marker.ts) so the editor can import it without pulling in the YAML parser.

/** A source rename the editor made since it read the model: `{type}/{from}` became `{type}/{to}`. */
export interface SourceRename {
  type: string;
  from: string;
  to: string;
}

/**
 * The model with `from` renamed to `to` under `type`, in every layer that mentions it. One
 * implementation for both sides of the API: the editor calls it to rename in place, and a save
 * calls it on the model read from disk so a renamed source's stored private values still answer
 * the markers the editor sends under the new name.
 */
export function renameSource(model: SourcesModel, type: string, from: string, to: string): SourcesModel {
  if (!from || !to || from === to) return model;
  const rename = (layer: LayerData): LayerData => {
    const sources = layer[type];
    if (!sources || !(from in sources)) return layer;
    const next: Record<string, SourceFields> = {};
    for (const [key, value] of Object.entries(sources)) next[key === from ? to : key] = value;
    return { ...layer, [type]: next };
  };
  const env: Record<string, EnvLayers> = {};
  for (const [name, layers] of Object.entries(model.layers.env)) env[name] = { public: rename(layers.public), private: rename(layers.private) };
  return { ...model, layers: { ...model.layers, base: rename(model.layers.base), private: rename(model.layers.private), env } };
}

const declares = (model: SourcesModel, type: string, name: string): boolean => name in (model.layers.base[type] ?? {});

/**
 * The model read from disk as the sent renames see it, so that a renamed source keeps the private
 * values stored under its old name. A rename is applied only when both models say it is one: the
 * disk declared `from` and not `to`, and the sent model gave `from` up. Anything else is left
 * alone and the marker then fails on its own ("no stored private value to keep") — a stored secret
 * is never moved onto another source by a guess, and never merged into one that already exists.
 */
export function renamedStored(stored: SourcesModel, sent: SourcesModel, renames: readonly SourceRename[]): SourcesModel {
  let out = stored;
  for (const { type, from, to } of renames) {
    if (!type || !from || !to || from === to) continue;
    if (!declares(out, type, from) || declares(out, type, to)) continue;
    if (declares(sent, type, from)) continue;
    out = renameSource(out, type, from, to);
  }
  return out;
}
