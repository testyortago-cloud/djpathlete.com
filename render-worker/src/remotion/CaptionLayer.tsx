// render-worker/src/remotion/CaptionLayer.tsx
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"
import type { CaptionPage } from "../lib/caption-paging.js"

// Load the brand heading font (Lexend Exa, weight 800) FOR THE RENDER. Relying on
// the OS-installed font lets headless Chromium fall back to a system font; this
// @font-face loader (with delayRender readiness) guarantees the real glyphs are
// present before the first frame.
const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

export function CaptionLayer({ pages, accentHex }: { pages: CaptionPage[]; accentHex: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000

  // Show each page until the NEXT page begins (not just until its own last word
  // ends). Phrases are separated by silences; ending a page at its last word
  // blanked the captions during those gaps. Holding the phrase until the next one
  // starts keeps captions on screen continuously.
  let page: CaptionPage | null = null
  for (let i = 0; i < pages.length; i += 1) {
    const start = pages[i].startMs
    const end = i + 1 < pages.length ? pages[i + 1].startMs : pages[i].endMs
    if (ms >= start && ms < end) {
      page = pages[i]
      break
    }
  }
  if (!page) return null

  return (
    <AbsoluteFill
      style={{
        // Lower third, not dead center: pin to the bottom and lift off the floor.
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 72px 420px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          // Generous row + column spacing so the active (scaled-up) word never
          // collides with its neighbours.
          gap: "16px 36px",
          fontFamily,
          fontWeight: 800,
          fontSize: 88,
          lineHeight: 1.18,
          textAlign: "center",
          textShadow: "0 4px 24px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.9)",
        }}
      >
        {page.words.map((wd, i) => {
          const active = ms >= wd.startMs && ms < wd.endMs
          // Frame-based "pop" (CSS transitions don't render in Remotion): the
          // word scales up over the first ~90ms it's active, then holds.
          const pop = active
            ? interpolate(ms - wd.startMs, [0, 90], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            : 0
          return (
            <span
              key={i}
              style={{
                color: active ? accentHex : "white",
                transform: `scale(${1 + 0.08 * pop})`,
                transformOrigin: "center",
                display: "inline-block",
              }}
            >
              {wd.text}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
