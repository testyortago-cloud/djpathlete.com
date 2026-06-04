// components/admin/content-studio/reel-preview/remotion/CaptionedCut.tsx
// TWIN COPY of render-worker/src/remotion/CaptionedCut.tsx for the in-app
// <Player> preview. Differences from the worker copy: ".js" import specifiers
// dropped, caption types from @/lib/content-studio/caption-paging. Keep in sync.
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "@/lib/content-studio/caption-paging"
import { CaptionLayer } from "./CaptionLayer"
import { SourceLayer } from "./SourceLayer"
import { ProgressBar } from "./ProgressBar"
import { BrandBug } from "./BrandBug"
import { HookCard } from "./HookCard"
import { AudioLayer } from "./AudioLayer"
import { AccentGraphics } from "./AccentGraphics"

// A `type` (not `interface`) so it satisfies Remotion's
// `Props extends Record<string, unknown>` constraint on <Composition>/<Player>.
export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
  hook?: { text: string }
  music?: { track: string }
}

export function CaptionedCut({ videoSrc, pages, accentHex, hook, music }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AudioLayer pages={pages} music={music} hasHook={Boolean(hook?.text)} />
      <SourceLayer videoSrc={videoSrc} />
      <AccentGraphics accentHex={accentHex} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug />
    </AbsoluteFill>
  )
}
