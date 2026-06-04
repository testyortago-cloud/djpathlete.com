// components/admin/content-studio/reel-preview/remotion/CaptionLayer.tsx
// TWIN COPY of render-worker/src/remotion/CaptionLayer.tsx for the in-app
// <Player> preview. Differences from the worker copy: caption types imported
// from @/lib/content-studio/caption-paging. loadFont() (Lexend Exa 800) is the
// SAME @remotion/google-fonts loader the worker uses, so the preview glyphs match
// the render (requires fonts.gstatic.com in the CSP font-src). Keep in sync.
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"
import type { CaptionPage } from "@/lib/content-studio/caption-paging"

// Load the brand heading font (Lexend Exa, weight 800). In the Player this injects
// an @font-face with delayRender readiness so the real glyphs are present before
// the first previewed frame — matching the worker's render.
const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

export type CaptionLayerProps = {
  pages: CaptionPage[]
  accentHex: string
}

export function CaptionLayer({ pages, accentHex }: CaptionLayerProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000

  // Captions sit lower-third throughout — including over full-screen b-roll
  // cutaways (no more rise-to-seam, since there is no longer a split row).
  const paddingBottom = 420

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

  // Subtle page-level "pop" when a new phrase appears (distinct from the per-word
  // entrance below): the whole block scales 0.97 -> 1.0 over ~0.16s.
  const pageStartFrame = (page.startMs / 1000) * fps
  const pageEnter = spring({
    frame: frame - pageStartFrame,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(0.16 * fps),
  })
  const pageScale = 0.97 + 0.03 * pageEnter

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        padding: `0 72px ${paddingBottom}px`,
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
          // Crisp outline: stroke painted BEHIND the fill (paint-order) for legibility over any background.
          WebkitTextStroke: "3px rgba(0,0,0,0.92)",
          paintOrder: "stroke fill",
          transform: `scale(${pageScale})`,
          transformOrigin: "center",
        }}
      >
        {page.words.map((wd, i) => {
          const startFrame = (wd.startMs / 1000) * fps
          // Per-word entrance: each word fades + rises into place over ~180ms,
          // starting at its own startMs — the page builds up word-by-word.
          const enter = spring({
            frame: frame - startFrame,
            fps,
            config: { damping: 200 }, // no overshoot for the entrance itself
            durationInFrames: Math.round(0.18 * fps),
          })
          const active = ms >= wd.startMs && ms < wd.endMs
          // Spring "bounce": overshoot then settle, starting when the word goes
          // active. The spring rests at 1, so an active word holds at scale ~1.14
          // for its whole window and snaps back to 1.0 on deactivation — that snap
          // is one frame and is masked by the simultaneous accent->white color
          // change, so it reads as the standard active-word treatment. (Note for
          // emphasis: keyword `fontSize` stacks on top of this scale.)
          const bounce = active
            ? spring({ frame: frame - startFrame, fps, config: { damping: 9, stiffness: 180, mass: 0.5 } })
            : 0
          const scale = 1 + 0.14 * bounce
          return (
            <span
              key={i}
              style={{
                // Active word (and emphasized words) render in the brand accent;
                // no background pill — the black outline + spring bounce make the
                // active word pop on their own.
                color: active || wd.emphasis ? accentHex : "white",
                fontSize: wd.emphasis ? "1.18em" : "1em",
                opacity: enter,
                transform: `translateY(${(1 - enter) * 24}px) scale(${scale})`,
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
