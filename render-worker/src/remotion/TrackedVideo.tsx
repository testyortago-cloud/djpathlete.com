// render-worker/src/remotion/TrackedVideo.tsx
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion"
import { faceAtMs, cropForMode, type FacePoint } from "../lib/face-track.js"

export type TrackedVideoProps = {
  videoSrc: string
  trajectory: FacePoint[]
}

// The talking head. Always fills the frame, face-tracked via the smoothed
// trajectory. It is ALWAYS mounted and UNMUTED — this element carries the
// client's voice, which must keep playing even while a full-screen b-roll clip
// is painted over it (BrollRow paints above this layer during its windows).
// AudioLayer only adds music/SFX.
export function TrackedVideo({ videoSrc, trajectory }: TrackedVideoProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const face = faceAtMs(trajectory, ms)
  const crop = cropForMode(face, "full")

  return (
    <AbsoluteFill
      style={{
        top: 0,
        height: "100%",
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
