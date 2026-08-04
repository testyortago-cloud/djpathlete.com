import React from "react"
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile } from "remotion"
import { COLORS } from "../promo/theme.js"
import { PromoBug } from "../promo/ui.js"
import { CHAPTERS, chapterFrames, chapterStarts, HEIGHT, msToFrames, TAKE_H, TAKE_W, WIDTH } from "./config.js"
import { Caption } from "./Caption.js"
import { ChapterTitle } from "./ChapterTitle.js"

// The take is 1600x1000 (that width IS the captured layout — recordVideo.size
// cannot upscale). Fit it to the 1080 height and letterbox the sides in brand
// colour rather than cropping, which would cut the admin chrome.
const scale = HEIGHT / TAKE_H
const videoW = Math.round(TAKE_W * scale)

const ChapterClip: React.FC<{ index: number; chapter: (typeof CHAPTERS)[number] }> = ({ index, chapter }) => {
  const frames = chapterFrames(chapter)
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.primaryDeep }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <OffthreadVideo
          src={staticFile(`walkthrough/${chapter.file.replace(/\.webm$/, ".mp4")}`)}
          // Skip the pre-login lead-in; beat timings start after sign-in.
          trimBefore={msToFrames(chapter.leadInMs ?? 0)}
          style={{ width: videoW, height: HEIGHT }}
        />
      </AbsoluteFill>

      <ChapterTitle index={index} title={chapter.title} />

      {chapter.beats.map((beat, i) => {
        const from = msToFrames(beat.startMs)
        const to = Math.min(msToFrames(beat.endMs), frames)
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
                <Audio src={staticFile(`walkthrough/audio/${beat.audio}`)} />
              </Sequence>
            ) : null}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

export const Walkthrough: React.FC = () => {
  const starts = chapterStarts()
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.primaryDeep, width: WIDTH, height: HEIGHT }}>
      {CHAPTERS.map((chapter, i) => (
        <Sequence
          key={chapter.id}
          from={starts[i]}
          durationInFrames={chapterFrames(chapter)}
          name={chapter.id}
        >
          <ChapterClip index={i + 1} chapter={chapter} />
        </Sequence>
      ))}
      <PromoBug />
    </AbsoluteFill>
  )
}
