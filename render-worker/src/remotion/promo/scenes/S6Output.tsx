// render-worker/src/remotion/promo/scenes/S6Output.tsx
// The answer to Darren's literal question — "what is the expected output?"
// One Excel workbook, a tab per question. Tabs light up in sequence while the
// Summary sheet fills in behind them.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, Eyebrow, Headline, numeric, useSceneFade } from "../ui.js"

const TABS = [
  "Summary",
  "Income by service",
  "Profit & loss",
  "Property",
  "Second business",
  "Household",
  "Receipt index",
]

// Sample figures only — illustrative, not real books.
const LINES: { label: string; value: string; at: number; tone?: "accent" }[] = [
  { label: "Business income", value: "$84,310", at: 96 },
  { label: "Deductible expenses", value: "$21,455", at: 116 },
  { label: "Net profit", value: "$62,855", at: 136 },
  { label: "Estimated tax set-aside", value: "$17,600", at: 160, tone: "accent" },
]

function Tab({ label, index }: { label: string; index: number }) {
  const frame = useCurrentFrame()
  const at = 44 + index * 9
  const t = interpolate(frame, [at, at + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const active = index === 0
  return (
    <div
      style={{
        opacity: t,
        transform: `translateY(${(1 - t) * 10}px)`,
        padding: "11px 15px",
        borderRadius: "10px 10px 0 0",
        border: `1px solid ${active ? "rgba(196,155,122,0.45)" : COLORS.line}`,
        borderBottom: "none",
        background: active ? "rgba(196,155,122,0.14)" : "rgba(255,255,255,0.04)",
        fontFamily: BODY,
        fontWeight: active ? 500 : 300,
        fontSize: 18,
        color: active ? COLORS.accent : COLORS.muted,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  )
}

function Line({
  label,
  value,
  at,
  tone,
}: {
  label: string
  value: string
  at: number
  tone?: "accent"
}) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [at, at + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  return (
    <div
      style={{
        opacity: t,
        transform: `translateX(${(1 - t) * 20}px)`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "22px 4px",
        borderBottom: `1px solid ${COLORS.line}`,
      }}
    >
      <span
        style={{
          fontFamily: BODY,
          fontWeight: tone === "accent" ? 500 : 300,
          fontSize: 30,
          color: tone === "accent" ? COLORS.accent : COLORS.muted,
        }}
      >
        {label}
      </span>
      <span
        style={{
          ...numeric,
          fontWeight: tone === "accent" ? 700 : 500,
          fontSize: tone === "accent" ? 42 : 34,
          color: tone === "accent" ? COLORS.accent : COLORS.white,
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function S6Output() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames)

  const sheetT = interpolate(frame, [36, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  return (
    <AbsoluteFill style={{ opacity }}>
      <Backdrop />
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: "0 120px",
          gap: 70,
        }}
      >
        <div style={{ width: 560, flexShrink: 0 }}>
          <Eyebrow delay={0}>The output</Eyebrow>
          <div style={{ height: 24 }} />
          <Headline delay={8} size={58}>
            One button. One workbook.
          </Headline>
          <div style={{ height: 28 }} />
          <div
            style={{
              opacity: interpolate(frame, [22, 46], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: EASE,
              }),
              fontFamily: BODY,
              fontWeight: 300,
              fontSize: 28,
              lineHeight: 1.5,
              color: COLORS.muted,
            }}
          >
            A tab for every question you'd otherwise answer by hand — income by
            service, profit and loss by category, the property, the household.
            <br />
            <br />
            Exports to Excel and QuickBooks. Produced quarterly, so your
            accountant is never handed twelve months cold.
          </div>
          <div style={{ height: 34 }} />
          <div
            style={{
              opacity: interpolate(frame, [190, 220], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: EASE,
              }),
              padding: "16px 22px",
              borderRadius: 12,
              border: `1px solid ${COLORS.line}`,
              background: "rgba(255,255,255,0.04)",
              fontFamily: BODY,
              fontWeight: 300,
              fontSize: 21,
              lineHeight: 1.45,
              color: COLORS.faint,
            }}
          >
            The tax figure is an <strong style={{ color: COLORS.muted, fontWeight: 500 }}>estimate</strong>,
            labelled as one. Your accountant still files.
          </div>
        </div>

        {/* minWidth:0 lets this column shrink to the space left over — without
            it the nowrap tab row forces the flex child past the frame edge. */}
        <div style={{ flex: 1, minWidth: 0, opacity: sheetT }}>
          <div style={{ display: "flex", gap: 5, paddingLeft: 8 }}>
            {TABS.map((t, i) => (
              <Tab key={t} label={t} index={i} />
            ))}
          </div>
          <div
            style={{
              padding: "34px 40px 20px",
              borderRadius: "0 16px 16px 16px",
              border: `1px solid ${COLORS.line}`,
              background: "rgba(255,255,255,0.045)",
              boxShadow: "0 22px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                fontFamily: HEADING,
                fontWeight: 600,
                fontSize: 25,
                color: COLORS.white,
                marginBottom: 8,
              }}
            >
              Summary — Q3 2026
            </div>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 300,
                fontSize: 19,
                color: COLORS.faint,
                marginBottom: 20,
              }}
            >
              Sample figures
            </div>
            {LINES.map((l) => (
              <Line key={l.label} {...l} />
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
