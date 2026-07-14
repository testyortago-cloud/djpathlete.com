// render-worker/src/remotion/promo/scenes/S3Income.tsx
// Step 1 — income that files itself. Rows land in the ledger one by one while a
// running total climbs, making "zero typing" concrete rather than claimed.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, Body, Eyebrow, Headline, numeric, useSceneFade } from "../ui.js"

type Row = { label: string; sub: string; amount: number; at: number }

// Sample figures only — no real client data (journal lesson: demo assets must
// never carry real rows).
const ROWS: Row[] = [
  { label: "Comeback Code — 12 weeks", sub: "Program · Stripe", amount: 349, at: 62 },
  { label: "Session pack — 10 sessions", sub: "Pack · Stripe", amount: 650, at: 88 },
  { label: "Rotational Reboot", sub: "Program · Stripe", amount: 249, at: 114 },
  { label: "Membership — monthly", sub: "Recurring · Stripe", amount: 180, at: 140 },
  { label: "Session pack — 5 sessions", sub: "Pack · Stripe", amount: 375, at: 166 },
]

function LedgerRow({ row, index }: { row: Row; index: number }) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [row.at, row.at + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  // A brief accent flash as each row lands, then it settles to the base surface.
  const flash = interpolate(frame, [row.at, row.at + 10, row.at + 30], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <div
      style={{
        opacity: t,
        transform: `translateX(${(1 - t) * 34}px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "20px 28px",
        marginBottom: 12,
        borderRadius: 14,
        border: `1px solid ${flash > 0.02 ? `rgba(196,155,122,${0.18 + flash * 0.5})` : COLORS.line}`,
        background: `rgba(255,255,255,${0.045 + flash * 0.05})`,
      }}
    >
      {/* flex:1 + minWidth:0 so the amount column below stays on a fixed x
          regardless of how long the label runs. */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flex: 1, minWidth: 0 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: COLORS.success,
            opacity: 0.5 + flash * 0.5,
            flexShrink: 0,
          }}
        />
        <div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 500,
              fontSize: 25,
              color: COLORS.white,
            }}
          >
            {row.label}
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 300,
              fontSize: 19,
              color: COLORS.faint,
              marginTop: 3,
            }}
          >
            {row.sub}
          </div>
        </div>
      </div>
      <div
        style={{
          ...numeric,
          fontWeight: 500,
          fontSize: 27,
          color: COLORS.white,
          flexShrink: 0,
          width: 120,
          textAlign: "right",
        }}
      >
        +${row.amount}
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 400,
          fontSize: 17,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          color: COLORS.accent,
          opacity: interpolate(frame, [row.at + 8, row.at + 24], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          flexShrink: 0,
          width: 96,
          textAlign: "right",
        }}
      >
        Logged
      </div>
    </div>
  )
}

export function S3Income() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames)

  // Running total counts up as each row lands.
  const total = ROWS.reduce((sum, r) => (frame >= r.at + 10 ? sum + r.amount : sum), 0)
  const shown = interpolate(frame, [62, 190], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <AbsoluteFill style={{ opacity }}>
      <Backdrop />
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: "0 130px",
          gap: 80,
        }}
      >
        <div style={{ width: 620, flexShrink: 0 }}>
          <Eyebrow delay={0}>Step one</Eyebrow>
          <div style={{ height: 26 }} />
          <Headline delay={8} size={68}>
            Income that files itself.
          </Headline>
          <div style={{ height: 30 }} />
          <Body delay={22} size={29} maxWidth={560}>
            Every payment through your platform — programs, session packs,
            memberships — lands in your books the moment it clears.
          </Body>
          <div style={{ height: 40 }} />
          <div
            style={{
              opacity: interpolate(frame, [40, 64], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: EASE,
              }),
              display: "inline-flex",
              alignItems: "baseline",
              gap: 16,
              padding: "18px 30px",
              borderRadius: 14,
              border: `1px solid rgba(196,155,122,0.35)`,
              background: "rgba(196,155,122,0.09)",
            }}
          >
            <span
              style={{
                fontFamily: BODY,
                fontWeight: 400,
                fontSize: 21,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: COLORS.accent,
              }}
            >
              Typed by you
            </span>
            <span
              style={{
                fontFamily: HEADING,
                fontWeight: 700,
                fontSize: 40,
                color: COLORS.white,
              }}
            >
              Nothing
            </span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 22,
              paddingBottom: 18,
              borderBottom: `1px solid ${COLORS.line}`,
              opacity: interpolate(frame, [44, 66], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <span
              style={{
                fontFamily: BODY,
                fontWeight: 400,
                fontSize: 20,
                letterSpacing: 2.4,
                textTransform: "uppercase",
                color: COLORS.faint,
              }}
            >
              Income ledger · live
            </span>
            <span
              style={{
                ...numeric,
                fontWeight: 500,
                fontSize: 34,
                color: COLORS.accent,
                opacity: shown,
              }}
            >
              ${total.toLocaleString("en-US")}
            </span>
          </div>
          {ROWS.map((row, i) => (
            <LedgerRow key={row.label} row={row} index={i} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
