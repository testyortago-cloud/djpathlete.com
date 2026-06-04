// components/admin/content-studio/reel-preview/remotion/BrollRow.tsx
// TWIN COPY of render-worker/src/remotion/BrollRow.tsx for the in-app <Player>
// preview. Difference from the worker copy: OffthreadVideo → Video. Keep in sync.
import { AbsoluteFill, Video, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion"

// One selected b-roll window: the time range it occupies in the reel + its clip.
export type BrollClip = { startMs: number; endMs: number; src: string }

export type BrollRowProps = {
  clips: BrollClip[]
}

// Soft crossfade (~0.3s) on each b-roll window's edges. The talking head is always
// rendered UNDERNEATH this layer, so ramping the b-roll's opacity dissolves it IN
// over the head and back OUT — a smooth transition instead of a hard cut.
const CROSSFADE_SECONDS = 0.3

// Full-screen b-roll cutaway. The outer layer is full-frame and TRANSPARENT, so
// outside every window nothing paints here and the talking head shows through.
// During a window the clip's <Sequence> paints a full-frame black backing + the
// muted, cover-fit clip on top, crossfading in/out. The voice comes from the
// talking head, so each clip stays MUTED.
export function BrollRow({ clips }: BrollRowProps) {
  const { fps } = useVideoConfig()
  const msToFrames = (ms: number) => Math.round((ms / 1000) * fps)
  const fadeFrames = Math.round(CROSSFADE_SECONDS * fps)

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {clips.map((clip, i) => {
        const from = msToFrames(clip.startMs)
        const duration = Math.max(1, msToFrames(clip.endMs) - from)
        return (
          <Sequence key={i} from={from} durationInFrames={duration} name={`broll-${i}`}>
            <BrollClipLayer src={clip.src} durationInFrames={duration} fadeFrames={fadeFrames} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

// A single b-roll clip that crossfades in/out over the talking head underneath.
// `frame` is relative to the enclosing <Sequence>, so 0 = window start.
function BrollClipLayer({
  src,
  durationInFrames,
  fadeFrames,
}: {
  src: string
  durationInFrames: number
  fadeFrames: number
}) {
  const frame = useCurrentFrame()
  // Cap the fade so in/out never overlap (keeps the interpolate range strictly
  // increasing); skip the fade on a degenerately short window.
  const fade = Math.min(fadeFrames, Math.floor((durationInFrames - 1) / 2))
  const opacity =
    fade <= 0
      ? 1
      : interpolate(frame, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
  return (
    <AbsoluteFill style={{ backgroundColor: "black", opacity }}>
      <Video src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
  )
}
