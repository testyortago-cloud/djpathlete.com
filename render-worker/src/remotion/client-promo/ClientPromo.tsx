// render-worker/src/remotion/client-promo/ClientPromo.tsx
//
// One composition, two shapes. `orientation` decides whether the phone footage
// fills the frame (social) or sits in a phone body beside the copy (web).
import React from "react"
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"
import { BODY, COLORS, EASE, HEADING } from "../promo/theme.js"
import {
  CAPTIONS,
  CTA_FRAMES,
  FOOTAGE_FRAMES,
  SEGMENTS,
  TAKE,
  secToFrames,
  segmentStarts,
} from "./config.js"

export type Orientation = "vertical" | "wide"
// Must be a `type`, not an `interface`: <Composition> requires props assignable
// to Record<string, unknown>, and only a type alias gets the implicit index
// signature. An interface here fails `npm run build` (tsc) in this worker.
export type ClientPromoProps = {
  orientation: Orientation
}

const BACKDROP = `linear-gradient(160deg, ${COLORS.primaryMid} 0%, ${COLORS.primaryDeep} 100%)`

/** The take, cut to SEGMENTS. Gaps in the source (loading skeletons) are dropped. */
const Footage: React.FC = () => {
  const starts = segmentStarts()
  return (
    <>
      {SEGMENTS.map((seg, i) => (
        <Sequence
          key={i}
          from={starts[i]}
          durationInFrames={secToFrames(seg.to - seg.from)}
          name={seg.note}
        >
          <OffthreadVideo
            src={staticFile(TAKE)}
            trimBefore={secToFrames(seg.from)}
            trimAfter={secToFrames(seg.to)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Sequence>
      ))}
    </>
  )
}

/** Phone body for the wide cut. The app is a phone app; show it in one. */
const PhoneShell: React.FC<{ height: number }> = ({ height }) => {
  const width = Math.round((height * 9) / 16)
  return (
    <div
      style={{
        width: width + 22,
        height: height + 22,
        borderRadius: 46,
        padding: 11,
        background: "linear-gradient(155deg, #2A2A2E 0%, #0C0C0E 100%)",
        boxShadow: "0 50px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
        boxSizing: "border-box",
      }}
    >
      {/* position:relative is load-bearing. <Sequence> renders an AbsoluteFill,
          which anchors to the nearest POSITIONED ancestor -- without this the
          footage escapes the phone and fills the whole 1920x1080 frame. */}
      <div
        style={{
          position: "relative",
          width,
          height,
          borderRadius: 36,
          overflow: "hidden",
          background: "#000",
        }}
      >
        <Footage />
      </div>
    </div>
  )
}

const Caption: React.FC<{ text: string; wide: boolean }> = ({ text, wide }) => {
  const frame = useCurrentFrame()
  // Short rise + fade so words land rather than blink.
  const t = interpolate(frame, [0, 7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  return (
    <div
      style={{
        opacity: t,
        transform: `translateY(${(1 - t) * 14}px)`,
        fontFamily: HEADING,
        fontWeight: 700,
        color: COLORS.white,
        fontSize: wide ? 60 : 52,
        lineHeight: 1.22,
        letterSpacing: "-0.015em",
        textAlign: wide ? "left" : "center",
        textWrap: "balance",
        textShadow: wide ? "none" : "0 3px 26px rgba(0,0,0,0.55)",
      }}
    >
      {text}
    </div>
  )
}

const Captions: React.FC<{ wide: boolean }> = ({ wide }) => (
  <>
    {CAPTIONS.map((c, i) => (
      <Sequence
        key={i}
        from={secToFrames(c.from)}
        durationInFrames={secToFrames(c.to - c.from)}
        layout="none"
      >
        {wide ? (
          // Right column of the two-up layout: phone at x=247..792, copy here.
          <div
            style={{
              position: "absolute",
              left: 912,
              top: "50%",
              transform: "translateY(-50%)",
              width: 760,
            }}
          >
            <Caption text={c.text} wide />
          </div>
        ) : (
          // Lower third, clear of the phone's own bottom nav bar.
          <div style={{ position: "absolute", left: 64, right: 64, bottom: 190 }}>
            <div
              style={{
                background: "rgba(8,36,48,0.90)",
                borderRadius: 26,
                padding: "30px 34px",
                border: `1px solid ${COLORS.line}`,
                backdropFilter: "blur(6px)",
              }}
            >
              <Caption text={c.text} wide={false} />
            </div>
          </div>
        )}
      </Sequence>
    ))}
  </>
)

const Cta: React.FC<{ wide: boolean }> = ({ wide }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const inT = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const outT = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill
      style={{
        background: BACKDROP,
        alignItems: "center",
        justifyContent: "center",
        opacity: Math.min(inT, outT),
      }}
    >
      <div style={{ textAlign: "center", transform: `translateY(${(1 - inT) * 18}px)` }}>
        <Img
          src={staticFile("brand/dj-logo.png")}
          style={{ width: wide ? 300 : 340, marginBottom: 54, filter: "brightness(0) invert(1)" }}
        />
        <div
          style={{
            fontFamily: HEADING,
            fontWeight: 700,
            color: COLORS.white,
            fontSize: wide ? 82 : 74,
            letterSpacing: "-0.02em",
            marginBottom: 26,
          }}
        >
          Train with Darren.
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 400,
            color: COLORS.accent,
            fontSize: wide ? 40 : 38,
            marginBottom: 14,
          }}
        >
          Apply for online coaching
        </div>
        <div
          style={{ fontFamily: BODY, fontWeight: 300, color: COLORS.muted, fontSize: wide ? 32 : 30 }}
        >
          darrenjpaul.com
        </div>
      </div>
    </AbsoluteFill>
  )
}

export const ClientPromo: React.FC<ClientPromoProps> = ({ orientation }) => {
  const { height } = useVideoConfig()
  const wide = orientation === "wide"

  return (
    <AbsoluteFill style={{ background: wide ? BACKDROP : "#000" }}>
      <Sequence durationInFrames={FOOTAGE_FRAMES}>
        {wide ? (
          // Two-up: phone left, copy right, both optically centred as a pair.
          // Phone spans x 247..792; the caption column starts at 912.
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", left: 247 }}>
              <PhoneShell height={height - 140} />
            </div>
          </AbsoluteFill>
        ) : (
          <Footage />
        )}
        <Captions wide={wide} />
        {/* Brand mark only on the wide cut. The vertical cut is full-bleed app,
            and the app's own header already reads "dp ATHLETE" in every frame --
            a second logo just sits on top of the first. */}
        {wide && (
          <Img
            src={staticFile("brand/dj-logo.png")}
            style={{
              position: "absolute",
              top: 56,
              left: 72,
              width: 128,
              filter: "brightness(0) invert(1)",
              opacity: 0.95,
            }}
          />
        )}
      </Sequence>

      <Sequence from={FOOTAGE_FRAMES} durationInFrames={CTA_FRAMES}>
        <Cta wide={wide} />
      </Sequence>
    </AbsoluteFill>
  )
}
