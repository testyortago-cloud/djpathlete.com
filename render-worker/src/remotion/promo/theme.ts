// render-worker/src/remotion/promo/theme.ts
// Brand tokens for the AI Bookkeeper promo. Mirrors the app's design system
// (app/globals.css): Green Azure primary, Gray Orange accent, Lexend type.
import { Easing } from "remotion"
import { loadFont as loadExa } from "@remotion/google-fonts/LexendExa"
import { loadFont as loadDeca } from "@remotion/google-fonts/LexendDeca"

// Headings use Lexend Exa (matches font-heading in the app), body uses Lexend
// Deca (font-body). Loaded at module scope so every scene shares one load.
export const { fontFamily: HEADING } = loadExa("normal", {
  weights: ["600", "700"],
  subsets: ["latin"],
})
export const { fontFamily: BODY } = loadDeca("normal", {
  weights: ["300", "400", "500"],
  subsets: ["latin"],
})

export const COLORS = {
  // Green Azure #0E3F50 and two darker steps for the gradient backdrop.
  primary: "#0E3F50",
  primaryDeep: "#082430",
  primaryMid: "#0A3242",
  // Gray Orange #C49B7A — the accent used for emphasis and the recommended tier.
  accent: "#C49B7A",
  accentBright: "#DDB893",
  white: "#FFFFFF",
  // Muted body copy over the dark backdrop.
  muted: "rgba(255,255,255,0.62)",
  faint: "rgba(255,255,255,0.34)",
  line: "rgba(255,255,255,0.12)",
  success: "#5FBF8B",
  danger: "#D9705F",
} as const

// A single easing curve for the whole video keeps the motion feeling like one
// piece rather than eight scenes with eight personalities.
export const EASE = Easing.bezier(0.16, 1, 0.3, 1)

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

// Scene lengths in seconds, in playback order. The composition derives every
// Sequence offset from these, so retiming a scene never means hand-editing
// downstream `from` values.
export const SCENES = {
  problem: 9,
  promise: 6,
  income: 9,
  receipts: 10,
  purpose: 11,
  output: 13,
  packages: 22,
  cta: 7,
} as const

export const SCENE_ORDER = [
  "problem",
  "promise",
  "income",
  "receipts",
  "purpose",
  "output",
  "packages",
  "cta",
] as const

export type SceneName = (typeof SCENE_ORDER)[number]

/** Start frame of a scene, derived from the ordered durations above. */
export function sceneStart(name: SceneName): number {
  let acc = 0
  for (const key of SCENE_ORDER) {
    if (key === name) break
    acc += SCENES[key] * FPS
  }
  return acc
}

export const TOTAL_FRAMES = SCENE_ORDER.reduce(
  (sum, key) => sum + SCENES[key] * FPS,
  0,
)
