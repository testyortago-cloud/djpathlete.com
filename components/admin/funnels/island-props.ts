// components/admin/funnels/island-props.ts — the trait <-> data-djp-props
// translation, kept free of GrapesJS so it can be tested directly.
//
// This logic previously lived inside the editor component, where it could only
// be exercised by mounting GrapesJS in jsdom. It never was, and a bug that made
// every island setting a silent no-op shipped as a result.

import { ISLANDS, type IslandName } from "@/lib/funnels/islands"
import { ISLAND_TRAITS } from "./island-traits"

/** Parses a placeholder's data-djp-props, falling back to the island defaults. */
export function readIslandProps(
  rawProps: string | undefined,
  name: IslandName,
): Record<string, unknown> {
  if (!rawProps || rawProps.trim().length === 0) return { ...ISLANDS[name].defaultProps }
  try {
    const parsed = JSON.parse(rawProps) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...ISLANDS[name].defaultProps }
    }
    return parsed as Record<string, unknown>
  } catch {
    return { ...ISLANDS[name].defaultProps }
  }
}

/**
 * Folds current trait values into the island's props.
 *
 * `getValue` returns `undefined` for a trait the owner has never touched (keep
 * whatever is there) and `""` for one they deliberately emptied (remove it, so
 * the compiler can complain about a missing required prop rather than silently
 * keeping a stale value).
 */
export function buildIslandProps(
  current: Record<string, unknown>,
  name: IslandName,
  getValue: (traitName: string) => unknown,
): Record<string, unknown> {
  const props = { ...current }

  for (const trait of ISLAND_TRAITS[name]) {
    const value = getValue(trait.name)
    if (value === undefined) continue

    if (value === "") {
      delete props[trait.name]
      continue
    }

    if (trait.type === "json") {
      try {
        props[trait.name] = JSON.parse(String(value))
      } catch {
        // Keep the previous value; publish reports it if it is genuinely wrong.
      }
      continue
    }

    if (trait.type === "number") {
      const parsed = Number(value)
      if (!Number.isNaN(parsed)) props[trait.name] = parsed
      continue
    }

    if (trait.type === "checkbox") {
      props[trait.name] = Boolean(value)
      continue
    }

    props[trait.name] = String(value)
  }

  return props
}
