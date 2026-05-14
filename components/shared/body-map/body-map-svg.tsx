import { cn } from "@/lib/utils"
import type { BodyRegion, InjurySide } from "@/types/database"

export interface BodyMapRegion {
  region: BodyRegion
  side: InjurySide
}

export interface BodyMapSVGProps {
  classForRegion?: (r: BodyMapRegion) => string
  onClick?: (r: BodyMapRegion) => void
  onHover?: (r: BodyMapRegion | null) => void
  className?: string
}

const DEFAULT_CLS =
  "fill-transparent stroke-transparent hover:fill-primary/30 hover:stroke-primary/50 stroke-1 cursor-pointer transition-colors focus:outline-none focus-visible:stroke-primary focus-visible:stroke-2"

const SILHOUETTE_CLS = "fill-muted-foreground/15 stroke-muted-foreground/25 pointer-events-none"

function Silhouette() {
  return (
    <g className={SILHOUETTE_CLS} strokeWidth="1">
      {/* Head & neck */}
      <ellipse cx="100" cy="35" rx="14" ry="16" />
      <rect x="93" y="50" width="14" height="8" rx="2" />
      {/* Shoulders */}
      <ellipse cx="74" cy="62" rx="9" ry="10" />
      <ellipse cx="126" cy="62" rx="9" ry="10" />
      {/* Torso */}
      <path d="M 76,58 L 124,58 Q 128,58 128,62 L 128,100 Q 126,106 120,106 L 80,106 Q 74,106 72,100 L 72,62 Q 72,58 76,58 Z" />
      {/* Upper arms */}
      <path d="M 64,64 Q 60,76 60,90 L 70,92 Q 72,78 74,66 Z" />
      <path d="M 136,64 Q 140,76 140,90 L 130,92 Q 128,78 126,66 Z" />
      {/* Forearms */}
      <path d="M 60,90 Q 58,102 56,114 L 64,116 Q 66,102 70,92 Z" />
      <path d="M 140,90 Q 142,102 144,114 L 136,116 Q 134,102 130,92 Z" />
      {/* Hands */}
      <ellipse cx="58" cy="122" rx="5" ry="7" />
      <ellipse cx="142" cy="122" rx="5" ry="7" />
      {/* Pelvis / hips */}
      <ellipse cx="86" cy="100" rx="9" ry="8" />
      <ellipse cx="114" cy="100" rx="9" ry="8" />
      {/* Thighs */}
      <path d="M 78,104 L 96,104 L 95,148 L 80,148 Z" />
      <path d="M 104,104 L 122,104 L 120,148 L 105,148 Z" />
      {/* Knees */}
      <ellipse cx="87" cy="150" rx="8" ry="6" />
      <ellipse cx="113" cy="150" rx="8" ry="6" />
      {/* Shins / calves */}
      <path d="M 82,153 L 92,153 L 91,184 L 84,184 Z" />
      <path d="M 108,153 L 118,153 L 116,184 L 109,184 Z" />
      {/* Ankles */}
      <ellipse cx="87" cy="187" rx="5" ry="4" />
      <ellipse cx="113" cy="187" rx="5" ry="4" />
      {/* Feet */}
      <ellipse cx="87" cy="196" rx="8" ry="4" />
      <ellipse cx="113" cy="196" rx="8" ry="4" />
    </g>
  )
}

export function BodyMapSVG({ classForRegion, onClick, onHover, className }: BodyMapSVGProps) {
  const cls = (r: BodyMapRegion) => cn(DEFAULT_CLS, classForRegion?.(r))
  const handle = (r: BodyMapRegion) => ({
    onClick: () => onClick?.(r),
    onMouseEnter: () => onHover?.(r),
    onMouseLeave: () => onHover?.(null),
    className: cls(r),
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `${r.region}${r.side !== "n_a" ? " " + r.side : ""}`,
    "data-region": r.region,
    "data-side": r.side,
  })

  return (
    <svg viewBox="0 0 400 220" className={cn("w-full max-w-2xl mx-auto", className)}>
      {/* FRONT */}
      <g transform="translate(0,10)">
        <text
          x="100"
          y="0"
          textAnchor="middle"
          className="fill-primary font-heading text-[11px] font-semibold uppercase tracking-[0.18em]"
        >
          Front
        </text>

        <Silhouette />

        {/* Interactive hit regions — front */}
        <ellipse cx="100" cy="35" rx="14" ry="16" {...handle({ region: "head", side: "n_a" })} />
        <rect x="93" y="50" width="14" height="8" {...handle({ region: "neck", side: "n_a" })} />
        <rect x="78" y="58" width="44" height="28" rx="4" {...handle({ region: "chest", side: "n_a" })} />
        <ellipse cx="74" cy="62" rx="9" ry="10" {...handle({ region: "shoulder", side: "left" })} />
        <ellipse cx="126" cy="62" rx="9" ry="10" {...handle({ region: "shoulder", side: "right" })} />
        <ellipse cx="64" cy="88" rx="7" ry="7" {...handle({ region: "elbow", side: "left" })} />
        <ellipse cx="136" cy="88" rx="7" ry="7" {...handle({ region: "elbow", side: "right" })} />
        <ellipse cx="58" cy="112" rx="5" ry="6" {...handle({ region: "wrist", side: "left" })} />
        <ellipse cx="142" cy="112" rx="5" ry="6" {...handle({ region: "wrist", side: "right" })} />
        <ellipse cx="58" cy="122" rx="5" ry="7" {...handle({ region: "hand", side: "left" })} />
        <ellipse cx="142" cy="122" rx="5" ry="7" {...handle({ region: "hand", side: "right" })} />
        <ellipse cx="86" cy="100" rx="9" ry="8" {...handle({ region: "hip", side: "left" })} />
        <ellipse cx="114" cy="100" rx="9" ry="8" {...handle({ region: "hip", side: "right" })} />
        <rect x="80" y="106" width="14" height="40" rx="6" {...handle({ region: "quad", side: "left" })} />
        <rect x="106" y="106" width="14" height="40" rx="6" {...handle({ region: "quad", side: "right" })} />
        <ellipse cx="87" cy="150" rx="8" ry="6" {...handle({ region: "knee", side: "left" })} />
        <ellipse cx="113" cy="150" rx="8" ry="6" {...handle({ region: "knee", side: "right" })} />
      </g>

      {/* BACK */}
      <g transform="translate(200,10)">
        <text
          x="100"
          y="0"
          textAnchor="middle"
          className="fill-primary font-heading text-[11px] font-semibold uppercase tracking-[0.18em]"
        >
          Back
        </text>

        <Silhouette />

        {/* Interactive hit regions — back */}
        <rect x="78" y="60" width="44" height="16" rx="3" {...handle({ region: "upper_back", side: "n_a" })} />
        <rect x="80" y="78" width="40" height="16" rx="3" {...handle({ region: "lower_back", side: "n_a" })} />
        <ellipse cx="86" cy="100" rx="9" ry="8" {...handle({ region: "glute", side: "left" })} />
        <ellipse cx="114" cy="100" rx="9" ry="8" {...handle({ region: "glute", side: "right" })} />
        <rect x="80" y="106" width="14" height="40" rx="6" {...handle({ region: "hamstring", side: "left" })} />
        <rect x="106" y="106" width="14" height="40" rx="6" {...handle({ region: "hamstring", side: "right" })} />
        <rect x="82" y="153" width="10" height="30" rx="4" {...handle({ region: "calf", side: "left" })} />
        <rect x="108" y="153" width="10" height="30" rx="4" {...handle({ region: "calf", side: "right" })} />
        <ellipse cx="87" cy="187" rx="5" ry="4" {...handle({ region: "ankle", side: "left" })} />
        <ellipse cx="113" cy="187" rx="5" ry="4" {...handle({ region: "ankle", side: "right" })} />
        <ellipse cx="87" cy="196" rx="8" ry="4" {...handle({ region: "foot", side: "left" })} />
        <ellipse cx="113" cy="196" rx="8" ry="4" {...handle({ region: "foot", side: "right" })} />
      </g>
    </svg>
  )
}
