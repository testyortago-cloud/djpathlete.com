// render-worker/src/remotion/BrandBug.tsx
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"

// Reuse the brand heading font (idempotent — CaptionLayer also loads it).
const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

export type BrandBugProps = {
  accentHex: string
}

export function BrandBug({ accentHex }: BrandBugProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Fade in over the first ~0.5s, then hold for the rest of the clip.
  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <div
      style={{
        position: "absolute",
        top: 40,
        left: 48,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        lineHeight: 1,
        fontFamily,
        // Shadow so the white wordmark reads over a bright frame.
        textShadow: "0 2px 10px rgba(0,0,0,0.7)",
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 54, color: "white", letterSpacing: "-0.02em" }}>dj</span>
      <span style={{ fontWeight: 800, fontSize: 17, color: accentHex, letterSpacing: "0.4em", marginTop: 2 }}>
        ATHLETE
      </span>
    </div>
  )
}
