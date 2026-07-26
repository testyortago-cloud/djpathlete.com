import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../promo/theme.js"

// A small chapter marker that rides in at the top-left for the first couple of
// seconds of each chapter, so a 9-minute video still feels navigable.
export const ChapterTitle: React.FC<{ index: number; title: string }> = ({ index, title }) => {
  const frame = useCurrentFrame()
  const HOLD = 66 // ~2.2s

  const opacity = interpolate(frame, [0, 12, HOLD - 12, HOLD], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const slide = interpolate(frame, [0, 14], [-22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  if (frame > HOLD) return null

  return (
    <div
      style={{
        position: "absolute",
        top: 44,
        left: 56,
        opacity,
        transform: `translateX(${slide}px)`,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 26px 14px 20px",
        borderRadius: 999,
        background: "rgba(8,36,48,0.88)",
        border: `1px solid ${COLORS.line}`,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontFamily: HEADING,
          fontWeight: 700,
          fontSize: 22,
          color: COLORS.accent,
          letterSpacing: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(index).padStart(2, "0")}
      </span>
      <span style={{ fontFamily: BODY, fontWeight: 500, fontSize: 26, color: COLORS.white }}>{title}</span>
    </div>
  )
}
