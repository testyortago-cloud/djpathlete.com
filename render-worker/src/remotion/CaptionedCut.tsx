// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"

// A `type` (not `interface`) so it satisfies Remotion's
// `Props extends Record<string, unknown>` constraint on <Composition> — an
// interface lacks an implicit index signature and would force an `as any` cast.
export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
}

const FONT = "Lexend Exa, system-ui, sans-serif"

export function CaptionedCut({ videoSrc, pages, accentHex }: CaptionedCutProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000

  const page = pages.find((p) => ms >= p.startMs && ms < p.endMs) ?? null

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* object-fit: cover — fill 1080x1920, center-crop the overflow */}
      <OffthreadVideo
        src={videoSrc}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {page && (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            padding: "0 80px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "0 18px",
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: 92,
              lineHeight: 1.1,
              textAlign: "center",
              textShadow: "0 4px 24px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.9)",
            }}
          >
            {page.words.map((wd, i) => {
              const active = ms >= wd.startMs && ms < wd.endMs
              return (
                <span
                  key={i}
                  style={{
                    color: active ? accentHex : "white",
                    transform: active ? "scale(1.15)" : "scale(1)",
                    transition: "transform 0.08s",
                    display: "inline-block",
                  }}
                >
                  {wd.text}
                </span>
              )
            })}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
