// lib/funnels/compile/types.ts — the shape a published funnel page is stored in.

import type { IslandName } from "@/lib/funnels/islands"

/**
 * A published page is a tree of these, stored as JSONB and rendered into real
 * React elements. It is deliberately NOT an HTML string: elements can only
 * carry attributes that survived the allowlist, so there is no
 * `dangerouslySetInnerHTML` anywhere in the page body and no XSS surface to
 * patch at render time.
 */
export type FunnelNode =
  | { t: "text"; v: string }
  | { t: "el"; tag: string; attrs: Record<string, string>; children: FunnelNode[] }
  | { t: "island"; name: IslandName; props: Record<string, unknown> }

export type CompileErrorCode =
  | "iframe_host_not_allowed"
  | "island_unknown"
  | "island_props_unparseable"
  | "island_props_invalid"
  | "css_parse_failed"

export interface CompileError {
  code: CompileErrorCode
  message: string
}

/**
 * Codes that must block a publish. An island the owner placed but misconfigured
 * would render as nothing — shipping that silently is worse than refusing to
 * publish and telling them which field is wrong.
 */
export const FATAL_COMPILE_CODES: readonly CompileErrorCode[] = [
  "island_unknown",
  "island_props_unparseable",
  "island_props_invalid",
  "css_parse_failed",
]

export function isFatalCompileError(error: CompileError): boolean {
  return FATAL_COMPILE_CODES.includes(error.code)
}

export type CompileResult =
  | { ok: true; nodes: FunnelNode[]; css: string; warnings: CompileError[] }
  | { ok: false; errors: CompileError[] }
