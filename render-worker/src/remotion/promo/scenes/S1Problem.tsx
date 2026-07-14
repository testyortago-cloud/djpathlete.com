// render-worker/src/remotion/promo/scenes/S1Problem.tsx
// Opens on the real problem: income scattered across five places, converging
// into one February pile-up.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, Headline, useSceneFade } from "../ui.js"

// Kept in the top band so the collapse below never crowds the headline.
const SOURCES = [
  { label: "The app / Stripe", x: 250, y: 255 },
  { label: "Venmo", x: 640, y: 180 },
  { label: "Cash", x: 1060, y: 245 },
  { label: "Bank transfers", x: 1430, y: 175 },
  { label: "Teams / center", x: 1660, y: 280 },
]

function SourceChip({
  label,
  x,
  y,
  index,
}: {
  label: string
  x: number
  y: number
  index: number
}) {
  const frame = useCurrentFrame()
  const delay = 18 + index * 9
  const t = interpolate(frame, [delay, delay + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  // Each chip drifts a few px on its own phase so the group never looks pasted.
  const bob = Math.sin((frame + index * 24) / 22) * 4

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y + bob,
        transform: `translate(-50%, -50%) scale(${0.86 + t * 0.14})`,
        opacity: t,
        padding: "16px 30px",
        borderRadius: 999,
        border: `1px solid ${COLORS.line}`,
        background: "rgba(255,255,255,0.06)",
        color: COLORS.white,
        fontFamily: BODY,
        fontWeight: 400,
        fontSize: 27,
        whiteSpace: "nowrap",
        boxShadow: "0 10px 30px rgba(0,0,0,0.28)",
      }}
    >
      {label}
    </div>
  )
}

export function S1Problem() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames)

  // The chips fall toward one messy pile at the bottom — the February moment.
  const collapse = interpolate(frame, [150, 210], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  return (
    <AbsoluteFill style={{ opacity }}>
      <Backdrop />

      <AbsoluteFill
        style={{
          transform: `translateY(${collapse * 44}px)`,
          opacity: 1 - collapse * 0.85,
        }}
      >
        {SOURCES.map((s, i) => (
          <SourceChip key={s.label} {...s} index={i} />
        ))}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          paddingTop: 290,
        }}
      >
        <Headline delay={82} size={92} align="center">
          Your money lives in five places.
        </Headline>

        <div style={{ height: 26 }} />

        <div
          style={{
            opacity: interpolate(frame, [150, 178], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE,
            }),
            transform: `translateY(${interpolate(frame, [150, 178], [22, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE,
            })}px)`,
            fontFamily: HEADING,
            fontWeight: 700,
            fontSize: 92,
            letterSpacing: -1.5,
            color: COLORS.accent,
            textAlign: "center",
          }}
        >
          It comes due in one.
        </div>

        <div style={{ height: 34 }} />

        <div
          style={{
            opacity: interpolate(frame, [196, 224], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE,
            }),
            fontFamily: BODY,
            fontWeight: 300,
            fontSize: 32,
            color: COLORS.muted,
            textAlign: "center",
            maxWidth: 1000,
            lineHeight: 1.5,
          }}
        >
          A messy spreadsheet. An extension filed. Your summer spent
          piecing together last year.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
