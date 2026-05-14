/**
 * Athlete-segment line icons for the site header dropdown.
 * Same design rules as lib/icons/sports.tsx: 24×24 viewBox, currentColor
 * stroke, ~1.75px weight, geometric, anti-cartoonish, unambiguous at 18×18.
 */

import type { SVGProps } from "react"

type AthleteIconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number | string }

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

/** Professional — trophy + base. Distinct from generic "athlete." */
export function ProfessionalAthleteIcon({ strokeWidth = 1.75, ...rest }: AthleteIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Trophy cup */}
      <path d="M8 4 H 16 V 9 C 16 12.3, 14.2 14, 12 14 C 9.8 14, 8 12.3, 8 9 Z" />
      {/* Side handles */}
      <path d="M8 6 C 5.8 6, 5 7.5, 5 9 C 5 10.5, 6 11.5, 8 11.5" />
      <path d="M16 6 C 18.2 6, 19 7.5, 19 9 C 19 10.5, 18 11.5, 16 11.5" />
      {/* Stem + base */}
      <line x1="12" y1="14" x2="12" y2="17.5" />
      <line x1="8" y1="17.5" x2="16" y2="17.5" />
      <rect x="6.5" y="18.5" width="11" height="2" rx="0.6" />
    </svg>
  )
}

/** Collegiate & Amateur — mortarboard graduation cap. */
export function CollegiateAthleteIcon({ strokeWidth = 1.75, ...rest }: AthleteIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Cap top — diamond */}
      <path d="M12 5 L 21 9 L 12 13 L 3 9 Z" />
      {/* Head + cap-band */}
      <path d="M6 10.5 V 14.5 C 6 16.4, 8.7 18, 12 18 C 15.3 18, 18 16.4, 18 14.5 V 10.5" />
      {/* Tassel */}
      <line x1="18.5" y1="9.5" x2="18.5" y2="14" />
      <circle cx="18.5" cy="15" r="0.9" />
    </svg>
  )
}

/** Youth — two figures, taller + smaller (development arc). */
export function YouthAthleteIcon({ strokeWidth = 1.75, ...rest }: AthleteIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Taller figure (left) — coach */}
      <circle cx="8" cy="6" r="2" />
      <path d="M8 8.4 V 14 M 8 14 L 5.5 19 M 8 14 L 10.5 19 M 5.5 11 L 10.5 11" />
      {/* Shorter figure (right) — youth athlete */}
      <circle cx="16" cy="9" r="1.6" />
      <path d="M16 10.8 V 15 M 16 15 L 14 19 M 16 15 L 18 19 M 14.2 13 L 17.8 13" />
    </svg>
  )
}

/** Return to Sport — broken-then-mended chevron + medical cross. */
export function ReturnToSportAthleteIcon({ strokeWidth = 1.75, ...rest }: AthleteIconProps) {
  return (
    <svg {...base(rest)} strokeWidth={strokeWidth}>
      {/* Curved arrow up-and-right — "return" motion */}
      <path d="M 4 16 C 5 10, 9 6, 15 6" markerEnd="" />
      {/* Arrow head */}
      <path d="M 12.5 4.5 L 15 6 L 13.5 8.5" />
      {/* Medical plus inside a soft circle — clinical handoff */}
      <circle cx="17" cy="16" r="3.5" />
      <line x1="17" y1="14.2" x2="17" y2="17.8" />
      <line x1="15.2" y1="16" x2="18.8" y2="16" />
    </svg>
  )
}
