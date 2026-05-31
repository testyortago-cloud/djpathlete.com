// render-worker/src/remotion/HookCard.tsx
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"

const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

const HOOK_SECONDS = 2

export type HookCardProps = {
  text: string
  accentHex: string
}

export function HookCard({ text, accentHex }: HookCardProps) {
  const { fps } = useVideoConfig()
  return (
    <Sequence durationInFrames={Math.round(HOOK_SECONDS * fps)}>
      <HookCardInner text={text} accentHex={accentHex} />
    </Sequence>
  )
}

// Inner so useCurrentFrame() is measured RELATIVE to the Sequence start.
function HookCardInner({ text, accentHex }: HookCardProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const total = Math.round(HOOK_SECONDS * fps)
  // Spring up in, then fade out over the last ~0.3s.
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 160, mass: 0.6 } })
  const exit = interpolate(frame, [total - Math.round(0.3 * fps), total], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const opacity = Math.min(enter, exit)
  const scale = 0.8 + 0.2 * enter
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 80px" }}>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 96,
          lineHeight: 1.1,
          textAlign: "center",
          color: "white",
          opacity,
          transform: `scale(${scale})`,
          transformOrigin: "center",
          WebkitTextStroke: "4px rgba(0,0,0,0.92)",
          paintOrder: "stroke fill",
          textShadow: "0 6px 30px rgba(0,0,0,0.85)",
          borderBottom: `8px solid ${accentHex}`,
          paddingBottom: 18,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}
