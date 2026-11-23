import { z } from 'zod';

// The shapes of a project's sources (agents/specs/project-format.md, "Sources"): every type is
// inferred from its schema, so a shape is declared in exactly one place and the implementation
// (sources-yaml.ts) only imports it.
//
// The canonical *problem messages* stay in sources-yaml.ts on purpose: they are part of the format
// and must match the plugin's Java decoders byte for byte (`bun run format:check`), which a
// schema's own error text would not. These schemas describe shapes, not the format's wording.

/** header name -> value; `null` removes the header inherited from an earlier layer. */
export const HeaderMapSchema = z.record(z.string(), z.string().nullable());
export type HeaderMap = z.infer<typeof HeaderMapSchema>;

/** The fields of one source in one layer; `null` removes the field inherited from an earlier layer. */
export const SourceFieldsSchema = z.object({
  'base-url': z.string().nullable().optional(),
  headers: HeaderMapSchema.nullable().optional()
});
export type SourceFields = z.infer<typeof SourceFieldsSchema>;

/** One layer: type -> source name -> fields (a source with no fields is `{}`). */
export const LayerDataSchema = z.record(z.string(), z.record(z.string(), SourceFieldsSchema));
export type LayerData = z.infer<typeof LayerDataSchema>;

/** The two layers of one environment: `sources.{env}.yaml` and `sources.{env}.private.yaml`. */
export const EnvLayersSchema = z.object({
  public: LayerDataSchema,
  private: LayerDataSchema
});
export type EnvLayers = z.infer<typeof EnvLayersSchema>;

export const LayersSchema = z.object({
  /** `sources.yaml` without its `environments` list (that one is `SourcesModel.environments`). */
  base: LayerDataSchema,
  /** `sources.private.yaml`. */
  private: LayerDataSchema,
  env: z.record(z.string(), EnvLayersSchema)
});
export type Layers = z.infer<typeof LayersSchema>;

/** Every layer of a project, as the editor holds it and as `POST /api/v2/sources` receives it. */
export const SourcesModelSchema = z.object({
  environments: z.array(z.string()),
  layers: LayersSchema
});
export type SourcesModel = z.infer<typeof SourcesModelSchema>;

/** Where a layer file sits in the stack. */
export const LayerKindSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('base') }),
  z.object({ kind: z.literal('private') }),
  z.object({ kind: z.literal('env'), env: z.string(), isPrivate: z.boolean() })
]);
export type LayerKind = z.infer<typeof LayerKindSchema>;

/** A source rename the editor made since it read the model: `{type}/{from}` became `{type}/{to}`. */
export const SourceRenameSchema = z.object({
  type: z.string(),
  from: z.string(),
  to: z.string()
});
export type SourceRename = z.infer<typeof SourceRenameSchema>;

/** One source resolved for an environment (agents/specs/project-format.md, "Resolution"). */
export const ResolvedSourceSchema = z.object({
  ref: z.string(),
  type: z.string(),
  name: z.string(),
  /** The resolved base-url (`""` when the source is not configured for the environment). */
  baseUrl: z.string(),
  /** Resolved headers, names lower-case (openapi). */
  headers: z.record(z.string(), z.string()),
  /** Fields whose winning layer is a `.private.yaml` file (`base-url`, `headers.{name}`). */
  privateFields: z.array(z.string()),
  /** Secret strings of this source (agents/specs/runner-protocol.md, "Secrets"). */
  secrets: z.array(z.string()),
  configured: z.boolean()
});
export type ResolvedSource = z.infer<typeof ResolvedSourceSchema>;
