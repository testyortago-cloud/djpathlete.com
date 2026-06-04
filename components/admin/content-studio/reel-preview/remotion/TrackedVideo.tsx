// components/admin/content-studio/reel-preview/remotion/TrackedVideo.tsx
// TWIN COPY of render-worker/src/remotion/TrackedVideo.tsx for the in-app
// <Player> preview. Differences from the worker copy: OffthreadVideo → Video,
// face-track imported from ./face-track. Keep in sync.
import { AbsoluteFill, Video, useCurrentFrame, useVideoConfig } from "remotion"
import { faceAtMs, cropForMode, type FacePoint } from "./face-track"

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
      <Video
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
