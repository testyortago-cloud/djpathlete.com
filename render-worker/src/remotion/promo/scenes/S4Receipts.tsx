// render-worker/src/remotion/promo/scenes/S4Receipts.tsx
// Step 2 — the four intake channels Darren named: phone photo, email, Amazon,
// and in-person cash. Four cards converge on one ledger.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, Eyebrow, Headline, useSceneFade } from "../ui.js"

type Channel = {
  glyph: string
  title: string
  detail: string
  at: number
}

const CHANNELS: Channel[] = [
  { glyph: "📷", title: "Snap it", detail: "Paper receipt, one photo", at: 44 },
  { glyph: "✉️", title: "Forward it", detail: "Emailed receipts file themselves", at: 62 },
  { glyph: "📦", title: "Amazon", detail: "Split line by line", at: 80 },
  { glyph: "💵", title: "Cash", detail: "Two taps, in person", at: 98 },
]

function ChannelCard({ channel }: { channel: Channel }) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [channel.at, channel.at + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  return (
    <div
      style={{
        opacity: t,
        transform: `translateY(${(1 - t) * 30}px) scale(${0.92 + t * 0.08})`,
        flex: 1,
        padding: "34px 30px",
        borderRadius: 18,
        border: `1px solid ${COLORS.line}`,
        background: "rgba(255,255,255,0.05)",
        boxShadow: "0 16px 40px rgba(0,0,0,0.24)",
      }}
    >
      <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 20 }}>{channel.glyph}</div>
      <div
        style={{
          fontFamily: HEADING,
          fontWeight: 600,
          fontSize: 30,
          color: COLORS.white,
          marginBottom: 10,
        }}
      >
        {channel.title}
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 300,
          fontSize: 21,
          color: COLORS.muted,
          lineHeight: 1.4,
        }}
      >
        {channel.detail}
      </div>
    </div>
  )
}

export function S4Receipts() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames)

  const funnelT = interpolate(frame, [180, 215], [0, 1], {
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
          padding: "0 130px",
        }}
      >
        <Eyebrow delay={0}>Step two</Eyebrow>
        <div style={{ height: 22 }} />
        <Headline delay={8} size={68} align="center">
          Receipts arrive from everywhere.
        </Headline>
        <div style={{ height: 14 }} />
        <div
          style={{
            opacity: interpolate(frame, [22, 46], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE,
            }),
            fontFamily: BODY,
            fontWeight: 300,
            fontSize: 30,
            color: COLORS.muted,
            textAlign: "center",
          }}
        >
          So they're accepted from everywhere. No “correct” way to file anything.
        </div>

        <div style={{ height: 52 }} />

        <div
          style={{
            display: "flex",
            gap: 24,
            width: "100%",
            maxWidth: 1450,
            alignItems: "stretch",
          }}
        >
          {CHANNELS.map((c) => (
            <ChannelCard key={c.title} channel={c} />
          ))}
        </div>

        <div style={{ height: 44 }} />

        <div
          style={{
            opacity: funnelT,
            transform: `translateY(${(1 - funnelT) * 18}px)`,
            display: "inline-flex",
            alignItems: "center",
            gap: 18,
            padding: "20px 40px",
            borderRadius: 999,
            border: `1px solid rgba(196,155,122,0.4)`,
            background: "rgba(196,155,122,0.1)",
          }}
        >
          <span
            style={{
              fontFamily: HEADING,
              fontWeight: 600,
              fontSize: 32,
              color: COLORS.white,
            }}
          >
            One set of books
          </span>
          <span
            style={{
              fontFamily: BODY,
              fontWeight: 300,
              fontSize: 27,
              color: COLORS.accent,
            }}
          >
            sorted, categorized, and dated
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
