// render-worker/src/remotion/BrollRow.tsx
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from "remotion"

// One selected b-roll window: the time range it occupies in the reel + its clip.
export type BrollClip = { startMs: number; endMs: number; src: string }

export type BrollRowProps = {
  clips: BrollClip[]
}

// Full-screen b-roll cutaway. The outer layer is full-frame and TRANSPARENT, so
// outside every window nothing paints here and the talking head shows through.
// During a window the clip's <Sequence> paints a full-frame black backing + the
// muted, cover-fit clip on top — covering the head (which keeps playing audio
// underneath). The voice comes from the talking head, so each clip stays MUTED.
export function BrollRow({ clips }: BrollRowProps) {
  const { fps } = useVideoConfig()
  const msToFrames = (ms: number) => Math.round((ms / 1000) * fps)

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {clips.map((clip, i) => {
        const from = msToFrames(clip.startMs)
        const duration = Math.max(1, msToFrames(clip.endMs) - from)
        return (
          <Sequence key={i} from={from} durationInFrames={duration} name={`broll-${i}`}>
            <AbsoluteFill style={{ backgroundColor: "black" }}>
              <OffthreadVideo
                src={clip.src}
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </AbsoluteFill>
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
