// render-worker/src/remotion/promo/scenes/S8Cta.tsx
// Close: callback to the opening line. February was the problem; February is
// now one button.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, useSceneFade } from "../ui.js"

export function S8Cta() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames, 16)

  const headT = interpolate(frame, [8, 44], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const accentT = interpolate(frame, [44, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const subT = interpolate(frame, [86, 118], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  return (
    <AbsoluteFill style={{ opacity }}>
      <Backdrop />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: 120 }}
      >
        <div
          style={{
            opacity: headT,
            transform: `translateY(${(1 - headT) * 26}px)`,
            fontFamily: HEADING,
            fontWeight: 700,
            fontSize: 96,
            lineHeight: 1.1,
            letterSpacing: -2,
            color: COLORS.white,
            textAlign: "center",
          }}
        >
          February used to take
          <br />
          your whole summer.
        </div>

        <div style={{ height: 40 }} />

        <div
          style={{
            opacity: accentT,
            transform: `scale(${0.94 + accentT * 0.06})`,
            fontFamily: HEADING,
            fontWeight: 700,
            fontSize: 96,
            letterSpacing: -2,
            color: COLORS.accent,
            textAlign: "center",
          }}
        >
          Now it's one button.
        </div>

        <div style={{ height: 56 }} />

        <div
          style={{
            opacity: subT,
            transform: `translateY(${(1 - subT) * 16}px)`,
            fontFamily: BODY,
            fontWeight: 300,
            fontSize: 32,
            color: COLORS.muted,
            textAlign: "center",
          }}
        >
          Pick a package and I'll start the build.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
