// render-worker/src/remotion/SourceLayer.tsx
import { AbsoluteFill, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from "remotion"

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
      <OffthreadVideo
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
