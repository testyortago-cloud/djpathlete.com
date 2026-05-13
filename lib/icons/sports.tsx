/**
 * Sport-specific line icons for the site header dropdown.
 *
 * Design rules:
 * - 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, default 1.75 stroke
 * - Lucide-compatible component shape: accepts `className` + `strokeWidth`
 * - Geometric, anti-cartoonish — matches the brand's telemetry/biomechanics
 *   diagrams on /clinics. Each icon must be unambiguous at 18×18.
 */

import type { SVGProps } from "react"

type SportIconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number | string }

const base = (extra?: SVGProps<SVGSVGElement>) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": "true" as const,
  focusable: false,
  ...extra,
})

/** A tennis racket — oval frame, 4-string lattice, angled handle, grip wrap. */
export function TennisIcon({ strokeWidth = 1.75, ...rest }: SportIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Racket head */}
      <ellipse cx="10.5" cy="9" rx="5.5" ry="6.5" />
      {/* Strings — vertical */}
      <line x1="8" y1="3.5" x2="8" y2="14.6" />
      <line x1="10.5" y1="2.6" x2="10.5" y2="15.4" />
      <line x1="13" y1="3.5" x2="13" y2="14.6" />
      {/* Strings — horizontal */}
      <line x1="5.5" y1="7" x2="15.5" y2="7" />
      <line x1="5" y1="9" x2="16" y2="9" />
      <line x1="5.5" y1="11" x2="15.5" y2="11" />
      {/* Throat + handle */}
      <path d="M10.5 15.5 L14 22" />
      {/* Grip wrap */}
      <line x1="11.5" y1="18.5" x2="13.4" y2="17.5" />
      <line x1="12.3" y1="20" x2="14.2" y2="19" />
    </svg>
  )
}

/** Golf — flagstick with triangular flag and a teed ball at the base. */
export function GolfIcon({ strokeWidth = 1.75, ...rest }: SportIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Flagstick */}
      <line x1="7" y1="3" x2="7" y2="20" />
      {/* Pennant */}
      <path d="M7 4 L16.5 6.5 L7 9 Z" />
      {/* Ground line */}
      <line x1="3" y1="20" x2="21" y2="20" />
      {/* Tee + ball */}
      <line x1="14" y1="18.5" x2="14" y2="20" />
      <circle cx="14" cy="17" r="1.6" />
    </svg>
  )
}

/** Baseball — bat at an angle with the ball (seam) tucked next to the barrel. */
export function BaseballIcon({ strokeWidth = 1.75, ...rest }: SportIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Bat — thin handle expanding into a barrel, knob at the small end */}
      <path d="M4 20 L9 15 C 11 13, 13.5 10.5, 15.5 8.5 C 17 7, 18.5 5.5, 19 4.5" />
      <path d="M4 20 L7 17 C 9.5 14.5, 12 12, 14 10 C 15.5 8.5, 17 7, 18 6" />
      {/* Knob */}
      <circle cx="3.6" cy="20.4" r="0.9" />
      {/* Ball + seam */}
      <circle cx="17.6" cy="16.6" r="2.6" />
      <path d="M15.5 15.5 C 16.2 16, 16.6 16.6, 17 17.6 M19.7 15.6 C 19 16.1, 18.5 16.7, 18.2 17.7" />
    </svg>
  )
}

/** Soccer ball — outer circle, central pentagon, radiating panel seams. */
export function SoccerIcon({ strokeWidth = 1.75, ...rest }: SportIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="9" />
      {/* Central pentagon */}
      <path d="M12 8.4 L15.4 10.9 L14.1 14.9 L9.9 14.9 L8.6 10.9 Z" />
      {/* Seams from pentagon vertices to ball edge */}
      <line x1="12" y1="8.4" x2="12" y2="3" />
      <line x1="15.4" y1="10.9" x2="20.6" y2="9.2" />
      <line x1="14.1" y1="14.9" x2="17.3" y2="19.4" />
      <line x1="9.9" y1="14.9" x2="6.7" y2="19.4" />
      <line x1="8.6" y1="10.9" x2="3.4" y2="9.2" />
    </svg>
  )
}

/** Lacrosse — angled shaft with a triangular head and net mesh lines. */
export function LacrosseIcon({ strokeWidth = 1.75, ...rest }: SportIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Shaft */}
      <line x1="4.5" y1="20" x2="13" y2="11.5" />
      {/* Head — open triangular pocket */}
      <path d="M11 9.5 L20 5 L18 14 Z" />
      {/* Mesh */}
      <line x1="13" y1="8.5" x2="18.5" y2="11" />
      <line x1="15" y1="6.7" x2="18" y2="13" />
      <line x1="11.6" y1="11" x2="19.2" y2="8.6" />
    </svg>
  )
}

/** Pickleball — paddle face with the distinctive perforated hole grid + handle. */
export function PickleballIcon({ strokeWidth = 1.75, ...rest }: SportIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Paddle face */}
      <rect x="4.5" y="2.5" width="13" height="13" rx="2" />
      {/* Hole grid — 3×3 dots, drawn as tiny circles */}
      <circle cx="8" cy="6" r="0.65" />
      <circle cx="11" cy="6" r="0.65" />
      <circle cx="14" cy="6" r="0.65" />
      <circle cx="8" cy="9" r="0.65" />
      <circle cx="11" cy="9" r="0.65" />
      <circle cx="14" cy="9" r="0.65" />
      <circle cx="8" cy="12" r="0.65" />
      <circle cx="11" cy="12" r="0.65" />
      <circle cx="14" cy="12" r="0.65" />
      {/* Throat + handle */}
      <line x1="11" y1="15.5" x2="11" y2="17.5" />
      <rect x="9.8" y="17.5" width="2.4" height="4" rx="0.6" />
      {/* Grip wrap */}
      <line x1="9.8" y1="19" x2="12.2" y2="19" />
      <line x1="9.8" y1="20.3" x2="12.2" y2="20.3" />
    </svg>
  )
}
