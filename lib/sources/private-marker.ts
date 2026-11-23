// The stand-in for a secret in the sources model the browser sees (docs/project-format.md,
// "API"). A module of its own so the editor can import it without the YAML parser.

/**
 * What `GET /api/v2/sources/{project}` puts in place of every value of a `.private.yaml` layer.
 * On save, a field still holding the marker keeps the value stored on disk at the same place; a
 * new value replaces it; a field left out is removed.
 */
export const PRIVATE_MARKER = '<private>';

/** Whether a field value is the marker (a stored private value the browser cannot see). */
export const isPrivateMarker = (value: string | null | undefined): boolean => value === PRIVATE_MARKER;
