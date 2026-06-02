// render-worker/src/remotion/TrackedVideo.tsx
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion"
import { faceAtMs, cropForMode, type FacePoint } from "../lib/face-track.js"
import { modeAtMs, type LayoutSegment } from "../lib/layout-timeline.js"

export type TrackedVideoProps = {
  videoSrc: string
  trajectory: FacePoint[]
  layout: LayoutSegment[]
}

// The talking head. In "full" segments it fills the frame; in "split" segments it
// occupies the top half. In both, the crop follows the (smoothed) face. Audio stays
// ON here — this element carries the client's voice (AudioLayer only adds music/SFX).
export function TrackedVideo({ videoSrc, trajectory, layout }: TrackedVideoProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const mode = modeAtMs(layout, ms)
  const face = faceAtMs(trajectory, ms)
  const crop = cropForMode(face, mode)

  return (
    <AbsoluteFill
      style={{
        top: 0,
        height: mode === "split" ? "50%" : "100%",
        overflow: "hidden",
        backgroundColor: "black",
      }}
    >
      <OffthreadVideo
        src={videoSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${crop.scale}) translate(${crop.translateXPct}%, ${crop.translateYPct}%)`,
          transformOrigin: "center",
        }}
      />
    </AbsoluteFill>
  )
}
