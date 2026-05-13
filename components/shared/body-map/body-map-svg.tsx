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
  "fill-muted stroke-border stroke-1 hover:fill-primary/40 cursor-pointer transition-colors"

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
    <svg viewBox="0 0 400 200" className={cn("w-full", className)}>
      <g transform="translate(0,0)">
        <text x="100" y="14" textAnchor="middle" className="fill-muted-foreground text-xs">
          Front
        </text>
        <ellipse cx="100" cy="35" rx="14" ry="16" {...handle({ region: "head", side: "n_a" })} />
        <rect x="93" y="50" width="14" height="8" {...handle({ region: "neck", side: "n_a" })} />
        <rect x="78" y="58" width="44" height="28" rx="4" {...handle({ region: "chest", side: "n_a" })} />
        <ellipse cx="74" cy="62" rx="8" ry="10" {...handle({ region: "shoulder", side: "left" })} />
        <ellipse cx="126" cy="62" rx="8" ry="10" {...handle({ region: "shoulder", side: "right" })} />
        <ellipse cx="64" cy="86" rx="6" ry="7" {...handle({ region: "elbow", side: "left" })} />
        <ellipse cx="136" cy="86" rx="6" ry="7" {...handle({ region: "elbow", side: "right" })} />
        <ellipse cx="58" cy="108" rx="5" ry="6" {...handle({ region: "wrist", side: "left" })} />
        <ellipse cx="142" cy="108" rx="5" ry="6" {...handle({ region: "wrist", side: "right" })} />
        <ellipse cx="55" cy="120" rx="5" ry="6" {...handle({ region: "hand", side: "left" })} />
        <ellipse cx="145" cy="120" rx="5" ry="6" {...handle({ region: "hand", side: "right" })} />
        <ellipse cx="86" cy="98" rx="8" ry="8" {...handle({ region: "hip", side: "left" })} />
        <ellipse cx="114" cy="98" rx="8" ry="8" {...handle({ region: "hip", side: "right" })} />
        <rect x="80" y="108" width="14" height="32" rx="6" {...handle({ region: "quad", side: "left" })} />
        <rect x="106" y="108" width="14" height="32" rx="6" {...handle({ region: "quad", side: "right" })} />
        <ellipse cx="87" cy="146" rx="7" ry="6" {...handle({ region: "knee", side: "left" })} />
        <ellipse cx="113" cy="146" rx="7" ry="6" {...handle({ region: "knee", side: "right" })} />
      </g>
      <g transform="translate(200,0)">
        <text x="100" y="14" textAnchor="middle" className="fill-muted-foreground text-xs">
          Back
        </text>
        <rect x="78" y="58" width="44" height="14" rx="3" {...handle({ region: "upper_back", side: "n_a" })} />
        <rect x="80" y="74" width="40" height="14" rx="3" {...handle({ region: "lower_back", side: "n_a" })} />
        <ellipse cx="86" cy="98" rx="9" ry="8" {...handle({ region: "glute", side: "left" })} />
        <ellipse cx="114" cy="98" rx="9" ry="8" {...handle({ region: "glute", side: "right" })} />
        <rect x="80" y="108" width="14" height="32" rx="6" {...handle({ region: "hamstring", side: "left" })} />
        <rect x="106" y="108" width="14" height="32" rx="6" {...handle({ region: "hamstring", side: "right" })} />
        <rect x="82" y="148" width="10" height="24" rx="4" {...handle({ region: "calf", side: "left" })} />
        <rect x="108" y="148" width="10" height="24" rx="4" {...handle({ region: "calf", side: "right" })} />
        <ellipse cx="87" cy="178" rx="5" ry="5" {...handle({ region: "ankle", side: "left" })} />
        <ellipse cx="113" cy="178" rx="5" ry="5" {...handle({ region: "ankle", side: "right" })} />
        <ellipse cx="87" cy="190" rx="6" ry="4" {...handle({ region: "foot", side: "left" })} />
        <ellipse cx="113" cy="190" rx="6" ry="4" {...handle({ region: "foot", side: "right" })} />
      </g>
    </svg>
  )
}
