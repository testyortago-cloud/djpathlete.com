// render-worker/src/remotion/BrandBug.tsx
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion"

// The brand "dj" mark — the same icon the marketing site navbar uses
// (public/logos/logo-icon-light.png), copied into the worker's public dir and
// baked into the image (Dockerfile COPYs ./public; index.ts bundles with publicDir).
export function BrandBug() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Fade in over the first ~0.5s, then hold for the rest of the clip.
  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <Img
      src={staticFile("brand/dj-logo.png")}
      style={{
        position: "absolute",
        // The source PNG has transparent padding around the mark, so negative
        // offsets tuck the visible glyph into the top-left corner.
        top: -34,
        left: -28,
        width: 280,
        height: "auto",
        opacity,
        // Soft shadow so the white mark reads over a bright frame.
        filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.55))",
      }}
    />
  )
}
