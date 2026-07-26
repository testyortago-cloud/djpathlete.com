import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { BODY, COLORS, EASE } from "../promo/theme.js"

// Lower-third caption over the screen recording. A scrim sits behind it because
// the admin UI is light — white text alone would be unreadable over a table.
export const Caption: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame()

  const IN = 10
  const OUT = 8
  const opacity = interpolate(
    frame,
    [0, IN, Math.max(IN + 1, durationInFrames - OUT), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE },
  )
  const rise = interpolate(frame, [0, IN], [14, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: 54,
        paddingTop: 150,
        display: "flex",
        justifyContent: "center",
        opacity,
        background: `linear-gradient(to top, ${COLORS.primaryDeep} 0%, rgba(8,36,48,0.92) 42%, rgba(8,36,48,0) 100%)`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${rise}px)`,
          maxWidth: 1380,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 400,
          fontSize: 40,
          lineHeight: 1.38,
          color: COLORS.white,
          textWrap: "balance",
        }}
      >
        {text}
      </div>
    </div>
  )
}
