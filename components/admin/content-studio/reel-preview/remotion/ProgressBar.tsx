// components/admin/content-studio/reel-preview/remotion/ProgressBar.tsx
// TWIN COPY of render-worker/src/remotion/ProgressBar.tsx for the in-app
// <Player> preview. Pure interpolation, browser-safe — keep in sync.
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion"

export type ProgressBarProps = {
  accentHex: string
}

export function ProgressBar({ accentHex }: ProgressBarProps) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // Fill grows linearly with playback. A faint track sits under the accent fill so
  // the bar reads even before much has elapsed.
  const pct = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: 10,
        backgroundColor: "rgba(255,255,255,0.18)",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", backgroundColor: accentHex }} />
    </div>
  )
}
