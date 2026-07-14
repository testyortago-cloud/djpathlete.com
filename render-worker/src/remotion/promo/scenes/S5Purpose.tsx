// render-worker/src/remotion/promo/scenes/S5Purpose.tsx
// Step 3 — the beat Darren asked for by name: every receipt captures its
// PURPOSE, not just its amount. "Meal" becomes the sentence that survives an
// audit. Left = the spreadsheet way, right = the AI prompting in the moment.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../theme.js"
import { Backdrop, Eyebrow, Headline, numeric, useSceneFade } from "../ui.js"

const PURPOSE =
  "Lunch with the baseball facility — discussing the athlete workshop partnership"

/** Types a string out character by character between two frames. */
function useTyped(text: string, from: number, to: number): string {
  const frame = useCurrentFrame()
  const chars = Math.round(
    interpolate(frame, [from, to], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  )
  return text.slice(0, chars)
}

function Card({
  children,
  tone,
  delay,
}: {
  children: React.ReactNode
  tone: "dim" | "accent"
  delay: number
}) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [delay, delay + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  return (
    <div
      style={{
        opacity: t,
        transform: `translateY(${(1 - t) * 24}px)`,
        flex: 1,
        minHeight: 430,
        padding: "38px 40px",
        borderRadius: 20,
        border: `1px solid ${tone === "accent" ? "rgba(196,155,122,0.42)" : COLORS.line}`,
        background:
          tone === "accent" ? "rgba(196,155,122,0.08)" : "rgba(255,255,255,0.035)",
        boxShadow: "0 18px 46px rgba(0,0,0,0.26)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  )
}

function CardLabel({ children, tone }: { children: React.ReactNode; tone: "dim" | "accent" }) {
  return (
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 500,
        fontSize: 19,
        letterSpacing: 2.6,
        textTransform: "uppercase",
        color: tone === "accent" ? COLORS.accent : COLORS.faint,
        marginBottom: 28,
      }}
    >
      {children}
    </div>
  )
}

export function S5Purpose() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = useSceneFade(durationInFrames)

  const typed = useTyped(PURPOSE, 132, 252)
  // Cursor blinks only while typing is still in progress.
  const typing = frame >= 132 && frame < 252
  const cursorOn = Math.floor(frame / 8) % 2 === 0

  const promptT = interpolate(frame, [96, 122], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const deductibleT = interpolate(frame, [258, 284], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })

  return (
    <AbsoluteFill style={{ opacity }}>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 130px" }}>
        <Eyebrow delay={0}>Step three</Eyebrow>
        <div style={{ height: 20 }} />
        <Headline delay={8} size={66}>
          Not <span style={{ color: COLORS.faint }}>“meal.”</span> The reason
          you were there.
        </Headline>

        <div style={{ height: 46 }} />

        <div style={{ display: "flex", gap: 34 }}>
          <Card tone="dim" delay={30}>
            <CardLabel tone="dim">Your spreadsheet today</CardLabel>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                paddingBottom: 22,
                borderBottom: `1px solid ${COLORS.line}`,
              }}
            >
              <span
                style={{
                  fontFamily: BODY,
                  fontWeight: 400,
                  fontSize: 40,
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                Meal
              </span>
              <span
                style={{ ...numeric, fontWeight: 500, fontSize: 40, color: "rgba(255,255,255,0.5)" }}
              >
                $48.20
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 300,
                fontSize: 24,
                color: COLORS.danger,
                lineHeight: 1.5,
              }}
            >
              Eight months later, nobody remembers who was there or what it was
              for. That's the deduction your accountant can't defend.
            </div>
          </Card>

          <Card tone="accent" delay={46}>
            <CardLabel tone="accent">With the AI Bookkeeper</CardLabel>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                paddingBottom: 18,
              }}
            >
              <span
                style={{
                  fontFamily: BODY,
                  fontWeight: 500,
                  fontSize: 40,
                  color: COLORS.white,
                }}
              >
                Ricco's Grill
              </span>
              <span style={{ ...numeric, fontWeight: 500, fontSize: 40, color: COLORS.white }}>
                $48.20
              </span>
            </div>

            <div
              style={{
                opacity: promptT,
                fontFamily: BODY,
                fontWeight: 400,
                fontSize: 22,
                color: COLORS.accent,
                marginBottom: 14,
              }}
            >
              What was this for?
            </div>

            <div
              style={{
                minHeight: 118,
                padding: "20px 22px",
                borderRadius: 12,
                border: `1px solid rgba(255,255,255,0.16)`,
                background: "rgba(0,0,0,0.22)",
                fontFamily: BODY,
                fontWeight: 400,
                fontSize: 26,
                lineHeight: 1.45,
                color: COLORS.white,
                opacity: promptT,
              }}
            >
              {typed}
              {typing && cursorOn ? (
                <span style={{ color: COLORS.accent }}>▌</span>
              ) : null}
            </div>

            <div style={{ flex: 1 }} />

            <div
              style={{
                opacity: deductibleT,
                transform: `translateY(${(1 - deductibleT) * 12}px)`,
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginTop: 22,
              }}
            >
              <span style={{ fontSize: 26 }}>✅</span>
              <span
                style={{
                  fontFamily: HEADING,
                  fontWeight: 600,
                  fontSize: 25,
                  color: COLORS.success,
                }}
              >
                Business meals · 50% deductible
              </span>
            </div>
          </Card>
        </div>

        <div style={{ height: 34 }} />

        <div
          style={{
            opacity: interpolate(frame, [284, 312], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE,
            }),
            fontFamily: BODY,
            fontWeight: 300,
            fontSize: 27,
            color: COLORS.muted,
            textAlign: "center",
          }}
        >
          The AI asks in the moment — while you still remember. It suggests the
          purpose from the vendor and your calendar; you confirm in a tap.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
