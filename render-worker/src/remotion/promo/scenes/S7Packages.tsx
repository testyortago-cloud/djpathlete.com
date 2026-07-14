// render-worker/src/remotion/promo/scenes/S7Packages.tsx
// The heart of the ask: what you get depends on the package. Three tiers reveal
// left-to-right, each with its scope stated plainly, then the recommended tier
// lifts while the other two recede.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, Eyebrow, Headline, useSceneFade } from "../ui.js"

type Pack = {
  name: string
  price: string
  scope: string
  points: string[]
  at: number
  recommended?: boolean
}

// The ladder is capability, not volume: $300 fixes this year, $500 the books
// record themselves, $750 the AI goes looking for money.
const PACKS: Pack[] = [
  {
    name: "Year-End Rescue",
    price: "$300",
    scope: "This tax year, cleaned up once",
    points: [
      "AI imports your Excel + statements",
      "The whole year categorized",
      "Accountant pack + workbook",
      "No ongoing automation",
    ],
    at: 46,
  },
  {
    name: "Bookkeeping Engine",
    price: "$500",
    scope: "Both businesses record themselves",
    points: [
      "Everything in Rescue, plus:",
      "Income syncs automatically",
      "Your wife's business, kept separate",
      "Receipts: photo / email / Amazon / cash",
      "Purpose captured on every receipt",
      "Monthly books-closed email",
      "Ask-your-books AI chat",
    ],
    at: 78,
  },
  {
    name: "Whole Picture",
    price: "$750",
    scope: "The AI works for you",
    points: [
      "Everything in Engine, plus:",
      "The property — depreciation & vacancy",
      "Household: medical, vehicles, kids",
      "AI deduction finder",
      "Rolling monthly tax forecast",
      "Missing-receipt watchdog",
      "Profit by service line",
    ],
    at: 110,
    recommended: true,
  },
]

function PackCard({ pack, index }: { pack: Pack; index: number }) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [pack.at, pack.at + 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  // Late in the scene the recommended tier lifts and the others step back, so
  // the eye lands where the recommendation is without a word being said.
  const focus = interpolate(frame, [430, 480], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const isRec = Boolean(pack.recommended)
  const dim = isRec ? 0 : focus * 0.55
  const lift = isRec ? focus * -16 : 0
  const scale = (0.94 + t * 0.06) * (isRec ? 1 + focus * 0.03 : 1 - focus * 0.02)

  return (
    <div
      style={{
        opacity: t * (1 - dim),
        transform: `translateY(${(1 - t) * 30 + lift}px) scale(${scale})`,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "34px 32px 38px",
        borderRadius: 20,
        border: `1px solid ${isRec ? `rgba(196,155,122,${0.45 + focus * 0.35})` : COLORS.line}`,
        background: isRec
          ? `rgba(196,155,122,${0.08 + focus * 0.05})`
          : "rgba(255,255,255,0.04)",
        boxShadow: isRec
          ? `0 20px 60px rgba(0,0,0,${0.3 + focus * 0.15})`
          : "0 14px 40px rgba(0,0,0,0.22)",
        position: "relative",
      }}
    >
      {isRec ? (
        <div
          style={{
            position: "absolute",
            top: -15,
            left: 32,
            padding: "7px 18px",
            borderRadius: 999,
            background: COLORS.accent,
            color: COLORS.primaryDeep,
            fontFamily: BODY,
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            opacity: t,
          }}
        >
          Recommended
        </div>
      ) : null}

      <div
        style={{
          fontFamily: HEADING,
          fontWeight: 600,
          fontSize: 32,
          color: COLORS.white,
          marginBottom: 6,
        }}
      >
        {pack.name}
      </div>

      <div
        style={{
          fontFamily: HEADING,
          fontWeight: 700,
          fontSize: 66,
          letterSpacing: -2,
          color: isRec ? COLORS.accent : COLORS.white,
          marginBottom: 4,
        }}
      >
        {pack.price}
      </div>

      <div
        style={{
          fontFamily: BODY,
          fontWeight: 300,
          fontSize: 19,
          color: COLORS.faint,
          marginBottom: 18,
        }}
      >
        one-time · no subscription
      </div>

      <div
        style={{
          fontFamily: BODY,
          fontWeight: 500,
          fontSize: 22,
          color: isRec ? COLORS.accentBright : COLORS.muted,
          paddingBottom: 18,
          marginBottom: 18,
          borderBottom: `1px solid ${COLORS.line}`,
          lineHeight: 1.35,
          minHeight: 62,
        }}
      >
        {pack.scope}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {pack.points.map((p, i) => {
          const at = pack.at + 20 + i * 6
          const pt = interpolate(frame, [at, at + 14], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE,
          })
          const isLead = p.endsWith("plus:")
          return (
            <div
              key={p}
              style={{
                opacity: pt,
                transform: `translateX(${(1 - pt) * 12}px)`,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  color: isLead ? COLORS.faint : COLORS.accent,
                  fontSize: 19,
                  lineHeight: 1.5,
                  flexShrink: 0,
                }}
              >
                {isLead ? "↳" : "✓"}
              </span>
              <span
                style={{
                  fontFamily: BODY,
                  fontWeight: isLead ? 400 : 300,
                  fontSize: 21,
                  lineHeight: 1.45,
                  color: isLead ? COLORS.faint : COLORS.white,
                  fontStyle: isLead ? "italic" : "normal",
                }}
              >
                {p}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function S7Packages() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames)

  const closerT = interpolate(frame, [500, 536], [0, 1], {
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
          padding: "0 110px",
        }}
      >
        <Eyebrow delay={0}>Pick your scope</Eyebrow>
        <div style={{ height: 18 }} />
        <Headline delay={8} size={54} align="center">
          How far the AI goes is up to you.
        </Headline>

        <div style={{ height: 52 }} />

        <div
          style={{
            display: "flex",
            gap: 26,
            width: "100%",
            maxWidth: 1600,
            alignItems: "stretch",
          }}
        >
          {PACKS.map((p, i) => (
            <PackCard key={p.name} pack={p} index={i} />
          ))}
        </div>

        <div style={{ height: 40 }} />

        <div
          style={{
            opacity: closerT,
            transform: `translateY(${(1 - closerT) * 14}px)`,
            fontFamily: BODY,
            fontWeight: 300,
            fontSize: 27,
            color: COLORS.muted,
            textAlign: "center",
            maxWidth: 1200,
            lineHeight: 1.5,
          }}
        >
          A bookkeeper charges{" "}
          <span style={{ color: COLORS.white, fontWeight: 500 }}>$300–500 every month</span>
          . This is one payment, and then it runs itself.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
