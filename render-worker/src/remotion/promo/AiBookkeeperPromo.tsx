// render-worker/src/remotion/promo/AiBookkeeperPromo.tsx
// Sales/walkthrough promo for the AI Bookkeeper proposal: the problem, how it
// works, the output, and what changes per package.
//
// This is a MARKETING asset, not part of the client-facing render pipeline —
// it lives here to reuse the worker's Remotion install, fonts and brand assets.
// Rendered locally (`npx remotion render ... AiBookkeeperPromo`); the Cloud Run
// job never invokes it.
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from "remotion"
import { FPS, SCENES, TOTAL_FRAMES, sceneStart } from "./theme.js"
import { PromoBug } from "./ui.js"
import { S1Problem } from "./scenes/S1Problem.js"
import { S2Promise } from "./scenes/S2Promise.js"
import { S3Income } from "./scenes/S3Income.js"
import { S4Receipts } from "./scenes/S4Receipts.js"
import { S5Purpose } from "./scenes/S5Purpose.js"
import { S6Output } from "./scenes/S6Output.js"
import { S7Packages } from "./scenes/S7Packages.js"
import { S8Cta } from "./scenes/S8Cta.js"

export type AiBookkeeperPromoProps = {
  /** Filename under public/music. Empty string renders the promo silent. */
  musicTrack: string
}

// No voiceover competes with the bed, so it can sit higher than the captioned-cut
// mix (0.14) — but still under the level where it distracts from reading.
const MUSIC_VOLUME = 0.3

const SCENE_COMPONENTS = [
  { name: "problem", Component: S1Problem },
  { name: "promise", Component: S2Promise },
  { name: "income", Component: S3Income },
  { name: "receipts", Component: S4Receipts },
  { name: "purpose", Component: S5Purpose },
  { name: "output", Component: S6Output },
  { name: "packages", Component: S7Packages },
  { name: "cta", Component: S8Cta },
] as const

export function AiBookkeeperPromo({ musicTrack }: AiBookkeeperPromoProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#061a24" }}>
      {musicTrack ? (
        <Audio
          src={staticFile(`music/${musicTrack}`)}
          loop
          volume={(f) =>
            // Ease in off silence, then fade under the closing card.
            interpolate(
              f,
              [0, FPS, TOTAL_FRAMES - FPS * 2.5, TOTAL_FRAMES],
              [0, MUSIC_VOLUME, MUSIC_VOLUME, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
          }
        />
      ) : null}

      {SCENE_COMPONENTS.map(({ name, Component }) => (
        <Sequence
          key={name}
          from={sceneStart(name)}
          durationInFrames={SCENES[name] * FPS}
          name={name}
        >
          <Component />
        </Sequence>
      ))}

      {/* Brand mark rides above every scene rather than per-scene. */}
      <PromoBug />
    </AbsoluteFill>
  )
}
