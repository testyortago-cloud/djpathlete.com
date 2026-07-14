// render-worker/src/remotion/promo/scenes/S2Promise.tsx
// The turn: the books keep themselves, built into the platform Darren already
// runs. Deliberately quiet after the noise of scene 1.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, Eyebrow, useSceneFade } from "../ui.js"

export function S2Promise() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames)

  // The accent rule draws itself under the headline.
  const rule = interpolate(frame, [56, 92], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  const lift = interpolate(frame, [10, 42], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const headOpacity = interpolate(frame, [10, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  return (
    <AbsoluteFill style={{ opacity }}>
      <Backdrop />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: 120,
        }}
      >
        <Eyebrow delay={0}>AI Bookkeeper</Eyebrow>

        <div style={{ height: 40 }} />

        <div
          style={{
            opacity: headOpacity,
            transform: `translateY(${lift}px)`,
            fontFamily: HEADING,
            fontWeight: 700,
            fontSize: 104,
            lineHeight: 1.08,
            letterSpacing: -2,
            color: COLORS.white,
            textAlign: "center",
          }}
        >
          So the books keep
          <br />
          <span style={{ color: COLORS.accent }}>themselves.</span>
        </div>

        <div style={{ height: 46 }} />

        <div
          style={{
            width: 520 * rule,
            height: 2,
            background: `linear-gradient(90deg, rgba(196,155,122,0) 0%, ${COLORS.accent} 50%, rgba(196,155,122,0) 100%)`,
          }}
        />

        <div style={{ height: 46 }} />

        <div
          style={{
            opacity: interpolate(frame, [92, 124], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE,
            }),
            fontFamily: BODY,
            fontWeight: 300,
            fontSize: 34,
            color: COLORS.muted,
            textAlign: "center",
            maxWidth: 1080,
            lineHeight: 1.5,
          }}
        >
          Built directly into the platform you already run — not another
          subscription you forget to open.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
