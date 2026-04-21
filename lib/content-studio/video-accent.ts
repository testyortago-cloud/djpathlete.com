// lib/content-studio/video-accent.ts
// Deterministic accent color per video id. The same id always maps to the same
// color, so a video card and every post it originated are tied together visually.

// Palette is hand-tuned to sit next to the Green Azure primary without clashing.
// Each entry is an oklch() string fed to CSS via the --video-accent custom prop.
const PALETTE = [
  "oklch(0.68 0.12 180)", // teal
  "oklch(0.72 0.11 45)",  // warm apricot
  "oklch(0.62 0.14 260)", // indigo
  "oklch(0.70 0.13 140)", // fern
  "oklch(0.66 0.16 25)",  // terracotta
  "oklch(0.74 0.10 85)",  // honey
  "oklch(0.64 0.12 320)", // mauve
  "oklch(0.70 0.11 215)", // slate blue
] as const

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function accentForVideo(videoId: string): string {
  return PALETTE[hash(videoId) % PALETTE.length]
}

/**
 * Inline style that exposes --video-accent on the element. Use with
 * Tailwind arbitrary values like `bg-[var(--video-accent)]` or
 * `border-[color:var(--video-accent)]`.
 */
export function accentStyle(videoId: string): React.CSSProperties {
  return { ["--video-accent" as string]: accentForVideo(videoId) }
}
