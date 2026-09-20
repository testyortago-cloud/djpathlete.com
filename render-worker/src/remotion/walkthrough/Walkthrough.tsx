import React from "react"
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile } from "remotion"
import { COLORS } from "../promo/theme.js"
import { PromoBug } from "../promo/ui.js"
import { BOOKKEEPER, TEAM_PERMISSIONS, TIKTOK_DEMO } from "./config.js"
import { msToFrames, type ResolvedChapter, type Show } from "./show.js"
import { Caption } from "./Caption.js"
import { ChapterTitle } from "./ChapterTitle.js"

const ChapterClip: React.FC<{ index: number; chapter: ResolvedChapter; show: Show }> = ({
  index,
  chapter,
  show,
}) => {
  const { geometry } = show
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.primaryDeep }}>
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <OffthreadVideo
          src={staticFile(`${show.dir}/${chapter.file.replace(/\.webm$/, ".mp4")}`)}
          // leadInMs is 0 on staged takes — prepare cuts the pre-login portion
          // at encode time. Kept for takes staged before that change.
          trimBefore={msToFrames(chapter.leadInMs ?? 0)}
          style={{ position: "absolute", ...geometry }}
        />
      </AbsoluteFill>

      <ChapterTitle index={index} title={chapter.title} />

      {chapter.beats.map((beat, i) => {
        const from = msToFrames(beat.startMs)
        const to = Math.min(msToFrames(beat.endMs), chapter.frames)
        const dur = Math.max(1, to - from)
        // The beat is held for narration + a breath, so the voice line is
        // SHORTER than its caption. Bound the audio to its own length or the
        // compositor is asked for samples past the end of the WAV, which fails
        // the whole render rather than dropping a sample.
        const voiceFrames = beat.audioMs ? Math.max(1, Math.min(msToFrames(beat.audioMs), dur)) : 0
        return (
          <Sequence key={i} from={from} durationInFrames={dur} name={`caption-${i}`}>
            <Caption text={beat.text} durationInFrames={dur} />
            {/* Narration starts on the SAME frame as its caption, so the two
                can never drift apart — the recorder held this beat for exactly
                as long as this voice line runs. */}
            {beat.audio && voiceFrames ? (
              <Sequence from={0} durationInFrames={voiceFrames} name={`vo-${i}`}>
                <Audio src={staticFile(`${show.dir}/audio/${beat.audio}`)} />
              </Sequence>
            ) : null}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

/**
 * A persistent address chip.
 *
 * Playwright's recordVideo captures the PAGE VIEWPORT only — there is no
 * browser chrome in a take, so no address bar and no domain anywhere on screen.
 * That is fine for an internal how-to and fatal for a TikTok app review, whose
 * form requires "the domain of the website shown in the demo video matches the
 * website URL you provide". This states the URL the footage was actually shot
 * against; it is a label on real production footage, not a substitute for it.
 */
const AddressChip: React.FC<{ url: string }> = ({ url }) => (
  <div
    style={{
      position: "absolute",
      // Centred, not top-left: the sidebar's "dp ATHLETE" logo lives in that
      // corner and the chip sat straight on top of it. Centre is empty in every
      // chapter, and it reads like an address bar, which is the point.
      top: 18,
      left: "50%",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 18px",
      borderRadius: 999,
      backgroundColor: "rgba(10, 26, 32, 0.82)",
      color: "#F2F7F8",
      fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      fontSize: 24,
      fontWeight: 500,
      letterSpacing: 0.2,
    }}
  >
    <span style={{ opacity: 0.65, fontSize: 20 }}>🔒</span>
    {url}
  </div>
)

const WalkthroughShow: React.FC<{ show: Show; addressUrl?: string }> = ({ show, addressUrl }) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.primaryDeep, width: 1920, height: 1080 }}>
    {show.chapters.map((chapter, i) => (
      <Sequence
        key={chapter.id}
        from={chapter.startFrame}
        durationInFrames={chapter.frames}
        name={chapter.id}
      >
        <ChapterClip index={i + 1} chapter={chapter} show={show} />
      </Sequence>
    ))}
    {addressUrl ? <AddressChip url={addressUrl} /> : null}
    <PromoBug />
  </AbsoluteFill>
)

export const Walkthrough: React.FC = () => <WalkthroughShow show={BOOKKEEPER} />
export const TeamPermissionsWalkthrough: React.FC = () => <WalkthroughShow show={TEAM_PERMISSIONS} />
// The only show that carries the chip: it is the only one submitted to a
// reviewer who is required to check the domain.
export const TikTokDemo: React.FC = () => (
  <WalkthroughShow show={TIKTOK_DEMO} addressUrl="www.darrenjpaul.com" />
)
