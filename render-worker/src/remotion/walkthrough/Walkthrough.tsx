import React from "react"
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile } from "remotion"
import { COLORS } from "../promo/theme.js"
import { PromoBug } from "../promo/ui.js"
import { BOOKKEEPER, TEAM_PERMISSIONS } from "./config.js"
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

const WalkthroughShow: React.FC<{ show: Show }> = ({ show }) => (
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
    <PromoBug />
  </AbsoluteFill>
)

export const Walkthrough: React.FC = () => <WalkthroughShow show={BOOKKEEPER} />
export const TeamPermissionsWalkthrough: React.FC = () => <WalkthroughShow show={TEAM_PERMISSIONS} />
