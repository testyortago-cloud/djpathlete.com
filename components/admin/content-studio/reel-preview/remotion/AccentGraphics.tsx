// components/admin/content-studio/reel-preview/remotion/AccentGraphics.tsx
// TWIN COPY of render-worker/src/remotion/AccentGraphics.tsx for the in-app
// <Player> preview. Pure CSS animation, browser-safe — keep in sync.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import type { CSSProperties } from "react"

export type AccentGraphicsProps = {
  accentHex: string
}

export function AccentGraphics({ accentHex }: AccentGraphicsProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Brackets "draw in" over the first ~0.6s.
  const draw = interpolate(frame, [0, Math.round(0.6 * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const ARM = 96 // full bracket arm length (px)
  const INSET = 46 // distance from the frame edge
  const STROKE = 5
  const len = ARM * draw
  const bar = (s: CSSProperties): CSSProperties => ({
    position: "absolute",
    backgroundColor: accentHex,
    opacity: 0.9,
    ...s,
  })
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* top-right bracket (opens toward bottom-left) */}
      <div style={bar({ top: INSET, right: INSET, width: len, height: STROKE })} />
      <div style={bar({ top: INSET, right: INSET, width: STROKE, height: len })} />
      {/* bottom-left bracket (opens toward top-right) */}
      <div style={bar({ bottom: INSET, left: INSET, width: len, height: STROKE })} />
      <div style={bar({ bottom: INSET, left: INSET, width: STROKE, height: len })} />
    </AbsoluteFill>
  )
}
