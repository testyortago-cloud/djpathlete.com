// components/admin/content-studio/reel-preview/remotion/SourceLayer.tsx
// TWIN COPY of render-worker/src/remotion/SourceLayer.tsx for the in-app <Player>
// preview. Difference from the worker copy: OffthreadVideo → Video (the
// Player-native video component; OffthreadVideo is the render-only counterpart).
// Keep in sync.
import { AbsoluteFill, Video, interpolate, useCurrentFrame, useVideoConfig } from "remotion"

export type SourceLayerProps = {
  videoSrc: string
}

export function SourceLayer({ videoSrc }: SourceLayerProps) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // Slow "punch-in": ease the source from 1.0 to 1.06 across the whole clip so the
  // frame feels alive without obvious motion. object-fit:cover already fills the
  // frame, so scaling up just crops further in — no black edges appear.
  const zoom = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill>
      {/* object-fit: cover — fill 1080x1920, center-crop the overflow */}
      <Video
        src={videoSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${zoom})`,
          transformOrigin: "center",
        }}
      />
    </AbsoluteFill>
  )
}
