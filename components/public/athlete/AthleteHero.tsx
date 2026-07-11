import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { AthleteProfileData } from "@/lib/profile-share/data"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

function prettify(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 font-mono text-[11px] tracking-widest text-primary-foreground/90">
      {children}
    </span>
  )
}

/** Dark Arena hero — full-bleed primary with accent glows and an oversized initials watermark. */
export function AthleteHero({ data }: { data: AthleteProfileData }) {
  const initials = `${data.name.first.charAt(0)}${data.name.last.charAt(0)}`.toUpperCase()
  const fullAlt = `${data.name.first} ${data.name.last}`.trim()
  const meta = [data.sport, data.position, data.experienceLevel ? prettify(data.experienceLevel) : null]
    .filter(Boolean)
    .join(" · ")
  const weightLbs = data.weightKg !== null ? Math.round(data.weightKg * 2.20462) : null

  return (
    <header className="relative overflow-hidden bg-primary pb-16 pt-8 text-primary-foreground md:pb-20 md:pt-10 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
      {/* Accent glow field (EventDetailHero recipe, warmed up for the card). */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at top right, oklch(0.70 0.08 60 / 0.30), transparent 40%), radial-gradient(circle at bottom left, oklch(1 0 0 / 0.08), transparent 30%)",
        }}
      />
      {/* Oversized initials watermark — the jersey-number moment. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 select-none font-heading text-[11rem] font-bold leading-none tracking-tighter text-primary-foreground/[0.06] md:text-[17rem]"
      >
        {initials}
      </div>

      <div className="relative mx-auto w-full max-w-3xl px-4 md:px-6">
        <p className="djp-eyebrow">DJP Athlete Profile</p>

        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-center">
          <Avatar className="size-20 shrink-0 ring-2 ring-accent/70 ring-offset-2 ring-offset-primary md:size-24">
            {data.avatarUrl && <AvatarImage src={data.avatarUrl} alt={fullAlt} />}
            <AvatarFallback className="bg-accent/20 font-heading text-2xl text-accent md:text-3xl">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <h1 className="font-heading text-3xl font-bold uppercase leading-[0.95] tracking-tight md:text-5xl">
              {data.name.first} <span className="text-accent">{data.name.last}</span>
            </h1>
            {meta && <p className="mt-2 text-sm text-primary-foreground/75 md:text-base">{meta}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              {data.heightCm !== null && <Pill>{data.heightCm} CM</Pill>}
              {data.weightKg !== null && (
                <Pill>{data.weightUnit === "lbs" ? `${weightLbs} LBS` : `${data.weightKg} KG`}</Pill>
              )}
              {data.age !== null && <Pill>AGE {data.age}</Pill>}
            </div>
          </div>
        </div>

        <p className="mt-8 font-mono text-xs tracking-wider text-primary-foreground/50">
          Training with DJP since {MONTH_YEAR.format(new Date(data.memberSince))}
        </p>
      </div>
    </header>
  )
}
