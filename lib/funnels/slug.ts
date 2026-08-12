/**
 * The one slug derivation. It lived privately inside FunnelBoard until the
 * create dialog needed the same rule; two copies of a slug rule means two
 * answers to "what URL will this get", and the owner only ever sees one of them.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}
