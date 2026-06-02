// render-worker/src/remotion/BrollRow.tsx
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from "remotion"

// One selected b-roll window: the time range it occupies in the reel + its clip.
export type BrollClip = { startMs: number; endMs: number; src: string }

export type BrollRowProps = {
  clips: BrollClip[]
}

// Renders the bottom half. Each clip shows only during its window (a <Sequence>),
// cover-fit and MUTED (the voice comes from the talking head). Outside every
// window nothing renders here, so the talking head (full mode) shows through.
export function BrollRow({ clips }: BrollRowProps) {
  const { fps } = useVideoConfig()
  const msToFrames = (ms: number) => Math.round((ms / 1000) * fps)

  return (
    <AbsoluteFill style={{ top: "50%", height: "50%", overflow: "hidden", backgroundColor: "black" }}>
      {clips.map((clip, i) => {
        const from = msToFrames(clip.startMs)
        const duration = Math.max(1, msToFrames(clip.endMs) - from)
        return (
          <Sequence key={i} from={from} durationInFrames={duration} name={`broll-${i}`}>
            <OffthreadVideo
              src={clip.src}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
