// components/admin/content-studio/reel-preview/remotion/SplitReel.tsx
// TWIN COPY of render-worker/src/remotion/SplitReel.tsx for the in-app <Player>
// preview. Differences from the worker copy: ".js" import specifiers dropped,
// face-track from ./face-track, caption types from
// @/lib/content-studio/caption-paging. Keep in sync — the preview's fidelity to
// the final render depends on it.
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "@/lib/content-studio/caption-paging"
import type { FacePoint } from "./face-track"
import { TrackedVideo } from "./TrackedVideo"
import { BrollRow, type BrollClip } from "./BrollRow"
import { CaptionLayer } from "./CaptionLayer"
import { ProgressBar } from "./ProgressBar"
import { BrandBug } from "./BrandBug"
import { HookCard } from "./HookCard"
import { AudioLayer } from "./AudioLayer"
import { AccentGraphics } from "./AccentGraphics"

// A `type` (not `interface`) to satisfy Remotion's Props constraint on <Player>.
export type SplitReelProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
  trajectory: FacePoint[]
  broll: BrollClip[]
  hook?: { text: string }
  music?: { track: string }
}

export function SplitReel({
  videoSrc,
  pages,
  accentHex,
  trajectory,
  broll,
  hook,
  music,
}: SplitReelProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AudioLayer pages={pages} music={music} hasHook={Boolean(hook?.text)} />
      <TrackedVideo videoSrc={videoSrc} trajectory={trajectory} />
      <BrollRow clips={broll} />
      <AccentGraphics accentHex={accentHex} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug />
    </AbsoluteFill>
  )
}
