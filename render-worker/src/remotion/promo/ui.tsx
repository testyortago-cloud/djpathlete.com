// render-worker/src/remotion/promo/ui.tsx
// Shared visual primitives for the promo. Every animation here is driven by
// useCurrentFrame + interpolate — CSS transitions/animations do not render.
import React from "react"
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"
import { BODY, COLORS, EASE, HEADING } from "./theme.js"

/**
 * Fade+rise helper. `delay` and `duration` are in frames, relative to the
 * enclosing Sequence. Returns style you spread onto a element.
 */
export function useEntrance(delay = 0, duration = 18, rise = 26) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * rise}px)`,
  }
}

/**
 * Fades a scene's contents out over its final `frames`, so cuts between scenes
 * breathe instead of snapping.
 */
export function useSceneFade(durationInFrames: number, fadeFrames = 12) {
  const frame = useCurrentFrame()
  return interpolate(
    frame,
    [0, fadeFrames, durationInFrames - fadeFrames, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE },
  )
}

/** The dark Green Azure backdrop with a slow-drifting accent glow. */
export function Backdrop({ glow = true }: { glow?: boolean }) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // A slow horizontal drift keeps static text scenes from feeling frozen.
  const drift = interpolate(frame, [0, durationInFrames], [-40, 40], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(150deg, ${COLORS.primaryMid} 0%, ${COLORS.primaryDeep} 60%, #061a24 100%)`,
      }}
    >
      {glow ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(60% 55% at ${50 + drift / 12}% 18%, rgba(196,155,122,0.20) 0%, rgba(196,155,122,0) 62%)`,
          }}
        />
      ) : null}
      {/* Faint vignette so the frame edges sit back and centre content leads. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(78% 78% at 50% 50%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.42) 100%)",
        }}
      />
    </AbsoluteFill>
  )
}

/** Small brand mark, bottom-right, present on every scene. */
export function PromoBug() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = interpolate(frame, [0, fps * 0.6], [0, 0.85], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <Img
      src={staticFile("brand/dj-logo.png")}
      style={{
        position: "absolute",
        bottom: 34,
        right: 44,
        width: 132,
        height: "auto",
        opacity,
        filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.5))",
      }}
    />
  )
}

/** The accent eyebrow label that sits above a scene headline. */
export function Eyebrow({
  children,
  delay = 0,
}: {
  children: React.ReactNode
  delay?: number
}) {
  const style = useEntrance(delay, 16, 14)
  return (
    <div
      style={{
        ...style,
        fontFamily: BODY,
        fontWeight: 500,
        fontSize: 22,
        letterSpacing: 4.5,
        textTransform: "uppercase",
        color: COLORS.accent,
      }}
    >
      {children}
    </div>
  )
}

export function Headline({
  children,
  delay = 0,
  size = 78,
  align = "left",
}: {
  children: React.ReactNode
  delay?: number
  size?: number
  align?: React.CSSProperties["textAlign"]
}) {
  const style = useEntrance(delay, 20, 28)
  return (
    <h1
      style={{
        ...style,
        margin: 0,
        fontFamily: HEADING,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.1,
        letterSpacing: -1.5,
        color: COLORS.white,
        textAlign: align,
      }}
    >
      {children}
    </h1>
  )
}

export function Body({
  children,
  delay = 0,
  size = 30,
  color = COLORS.muted,
  maxWidth = 820,
  align = "left",
}: {
  children: React.ReactNode
  delay?: number
  size?: number
  color?: string
  maxWidth?: number
  align?: React.CSSProperties["textAlign"]
}) {
  const style = useEntrance(delay, 18, 20)
  return (
    <p
      style={{
        ...style,
        margin: 0,
        fontFamily: BODY,
        fontWeight: 300,
        fontSize: size,
        lineHeight: 1.5,
        color,
        maxWidth,
        textAlign: align,
      }}
    >
      {children}
    </p>
  )
}

/** Numbers that need to sit still while digits change. */
export const numeric: React.CSSProperties = {
  fontFamily: BODY,
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1',
}

export function money(cents: number): string {
  return `$${Math.round(cents).toLocaleString("en-US")}`
}
