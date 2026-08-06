import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { FadeIn } from "@/components/shared/FadeIn"
import type { AthleteProfileData } from "@/lib/profile-share/data"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

function prettify(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/**
 * Full Arena hero — oversized stacked name, outlined-initials watermark and a
 * broadcast spec bar (HEIGHT / WEIGHT / AGE). Each spec value renders as a
 * single text node ("188 CM") on purpose: tests match the whole string.
 */
export function AthleteHero({ data }: { data: AthleteProfileData }) {
  const firstName = data.name.first.trim()
  const lastName = data.name.last.trim()
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "DJP"
  const fullAlt = `${firstName} ${lastName}`.trim()
  const meta = [data.sport, data.position, data.experienceLevel ? prettify(data.experienceLevel) : null]
    .filter(Boolean)
    .join(" · ")
  const weightLbs = data.weightKg !== null ? Math.round(data.weightKg * 2.20462) : null

  const specs: { label: string; value: string }[] = []
  if (data.heightCm !== null) specs.push({ label: "Height", value: `${data.heightCm} CM` })
  if (data.weightKg !== null)
    specs.push({ label: "Weight", value: data.weightUnit === "lbs" ? `${weightLbs} LBS` : `${data.weightKg} KG` })
  if (data.age !== null) specs.push({ label: "Age", value: `${data.age} YRS` })

  return (
    <header className="relative overflow-hidden pb-20 pt-8 md:pb-24 md:pt-10">
      {/* Outlined-initials watermark — the jersey-number moment, now just a stroke. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2 select-none font-heading text-[13rem] font-bold leading-none tracking-tighter text-transparent [-webkit-text-stroke:1.5px_oklch(0.97_0.01_220/0.10)] md:-right-2 md:text-[21rem]"
      >
        {initials}
      </div>

      <div className="relative mx-auto w-full max-w-4xl px-4 md:px-6">
        <div className="flex items-center justify-between gap-4">
          <p className="djp-eyebrow">DJP Athlete Profile</p>
          <span aria-hidden className="hidden font-mono text-[10px] tracking-[0.3em] text-muted-foreground/70 sm:block">
            {initials}—CARD
          </span>
        </div>

        <div className="mt-10 flex flex-col gap-7 sm:flex-row sm:items-end md:mt-14 md:gap-10">
          <FadeIn duration={0.7} className="shrink-0">
            <Avatar className="size-24 shrink-0 shadow-[0_0_48px_-10px_color-mix(in_oklab,var(--accent)_55%,transparent)] ring-2 ring-accent/80 ring-offset-4 ring-offset-background md:size-32">
              {data.avatarUrl && <AvatarImage src={data.avatarUrl} alt={fullAlt} />}
              <AvatarFallback className="bg-accent/15 font-heading text-3xl text-accent md:text-4xl">
                {initials}
              </AvatarFallback>
            </Avatar>
          </FadeIn>

          <div className="min-w-0">
            <FadeIn delay={0.05} duration={0.7}>
              <h1 className="font-heading font-bold uppercase leading-[0.92] tracking-tight">
                {firstName && (
                  <span className="block text-[clamp(1.9rem,5.5vw,3.25rem)] text-foreground/95">{firstName}</span>
                )}
                {lastName && (
                  <span className="block text-[clamp(2.5rem,8vw,5rem)] text-accent">{lastName}</span>
                )}
              </h1>
            </FadeIn>
            {meta && (
              <FadeIn delay={0.12} duration={0.7}>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground md:text-xs">
                  {meta}
                </p>
              </FadeIn>
            )}
          </div>
        </div>

        {specs.length > 0 && (
          <FadeIn delay={0.18} duration={0.7}>
            {/* Full-width triptych when all three specs exist; hugs content when sparse. */}
            <dl
              className={`mt-10 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card/60 backdrop-blur-sm md:mt-12 ${
                specs.length === 3 ? "flex" : "inline-flex"
              }`}
            >
              {specs.map((s) => (
                <div
                  key={s.label}
                  className={`${specs.length === 3 ? "min-w-0" : "min-w-32"} flex-1 px-4 py-3 md:min-w-44 md:px-6 md:py-4`}
                >
                  <dt className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground">{s.label}</dt>
                  <dd className="mt-1 font-heading text-base font-semibold tabular-nums text-primary md:text-xl">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </FadeIn>
        )}

        <p className="mt-10 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 md:mt-12">
          <span aria-hidden className="inline-block h-px w-7 bg-accent/60" />
          Training with DJP since {MONTH_YEAR.format(new Date(data.memberSince))}
        </p>
      </div>

      {/* Hero cut line — the stat strip overlaps it from below. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
    </header>
  )
}
