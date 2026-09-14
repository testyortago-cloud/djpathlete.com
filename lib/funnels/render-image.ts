// lib/funnels/render-image.ts — the page, as a browser actually draws it.
//
// ---------------------------------------------------------------------------
// THIS MODULE NEVER THROWS.
// ---------------------------------------------------------------------------
// Same promise as `review/pipeline.ts`, for the same reason: it runs after the
// owner's page is already saved, so no failure in here is worth showing them an
// error for. Trouble is reported in `RenderedPage.error` and the review then
// runs on JSON exactly as it did before this feature existed.

import type { AgentImage } from "@/lib/ai/anthropic"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import {
  SECTION_RENDER_MAX_TILES,
  SECTION_RENDER_TILE_HEIGHT,
  SECTION_RENDER_VIEWPORT_WIDTH,
} from "@/lib/funnels/sections/builder-config"

/**
 * The three faces `app/layout.tsx` loads via `next/font/google`, which are the
 * ENTIRE font budget any funnel page has. `doc.ts`'s ALLOWED_FONT_FAMILIES
 * says so: everything else in a `FONT_STACKS` entry is a system keyword or a
 * pre-installed face, never a download.
 */
export const RENDER_FONT_FAMILIES = ["Lexend Exa", "Lexend Deca", "JetBrains Mono"] as const

const FONT_HEAD =
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2` +
  `?family=Lexend+Deca:wght@300..700&family=Lexend+Exa:wght@400..800` +
  `&family=JetBrains+Mono:wght@400..700&display=swap">` +
  `<style>:root{` +
  `--font-lexend-exa:"Lexend Exa";` +
  `--font-lexend-deca:"Lexend Deca";` +
  `--font-jetbrains-mono:"JetBrains Mono";` +
  `}</style>`

/**
 * THE WRAPPER IS THE WHOLE TRICK, AND OMITTING IT IS SILENT.
 *
 * `reassemble()` returns html that starts at `<div class="djp-page">` and css
 * in which EVERY selector is scoped to `#djp-funnel-root`. That id comes from
 * the host page — `/go`, `/preview` and `/funnel-preview` each supply it. Build
 * this document without it and all 237 rules load, match nothing, and the
 * screenshot is of completely unstyled HTML. A critic shown that reports a
 * page-wide disaster on a page that is fine, and the reviser then rewrites a
 * good document to fix it.
 */
export function buildRenderDocument(html: string, css: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">${FONT_HEAD}` +
    `<style>${css}</style></head>` +
    `<body style="margin:0"><div id="${FUNNEL_ROOT_ID}">${html}</div></body></html>`
  )
}

export interface TilePlan {
  slices: Array<{ y: number; height: number }>
  truncated: boolean
}

/**
 * Slices a page into images whose long edge stays under Anthropic's ~1568px
 * downscale threshold, so every tile is passed through at full size.
 *
 * `truncated` is REPORTED, not hidden. A critic that believes it has seen the
 * whole page will say the page ends where the last image does.
 */
export function planTiles(
  pageHeight: number,
  tileHeight: number = SECTION_RENDER_TILE_HEIGHT,
  maxTiles: number = SECTION_RENDER_MAX_TILES,
): TilePlan {
  if (pageHeight <= 0) return { slices: [], truncated: false }

  const slices: Array<{ y: number; height: number }> = []
  for (let y = 0; y < pageHeight && slices.length < maxTiles; y += tileHeight) {
    slices.push({ y, height: Math.min(tileHeight, pageHeight - y) })
  }
  const captured = slices.reduce((total, slice) => total + slice.height, 0)
  return { slices, truncated: captured < pageHeight }
}

export const RENDER_IMAGE_WIDTH = SECTION_RENDER_VIEWPORT_WIDTH
export type { AgentImage }
