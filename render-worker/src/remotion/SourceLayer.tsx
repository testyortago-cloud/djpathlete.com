// render-worker/src/remotion/SourceLayer.tsx
import { AbsoluteFill, OffthreadVideo } from "remotion"

export type SourceLayerProps = {
  videoSrc: string
}

export function SourceLayer({ videoSrc }: SourceLayerProps) {
  return (
    <AbsoluteFill>
      {/* object-fit: cover — fill 1080x1920, center-crop the overflow */}
      <OffthreadVideo src={videoSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
  )
}
