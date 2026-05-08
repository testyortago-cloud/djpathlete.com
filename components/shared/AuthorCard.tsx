import Image from "next/image"
import Link from "next/link"
import { Linkedin, Instagram, ArrowRight } from "lucide-react"
import { DJP_SAME_AS } from "@/lib/brand/author"

type Variant = "compact" | "full"

interface AuthorCardProps {
  /**
   * "compact" — single-row card for top of post (byline-style).
   * "full" — multi-line bio block for end of post.
   */
  variant?: Variant
  /** Visible "Updated [date]" stamp; pass when the post has been edited after publish. */
  updatedDate?: string | null
  /** Originally-published date (always rendered when present). */
  publishedDate?: string | null
  className?: string
}

const findSocial = (matcher: string) => DJP_SAME_AS.find((u) => u.includes(matcher))

const linkedInUrl = findSocial("linkedin.com")
const instagramUrl = findSocial("instagram.com")

function formatDate(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}

export function AuthorCard({ variant = "full", publishedDate, updatedDate, className = "" }: AuthorCardProps) {
  const published = formatDate(publishedDate)
  const updated = formatDate(updatedDate)
  const showUpdated = updated && published && updated !== published

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="size-10 shrink-0 overflow-hidden rounded-full">
          <Image
            src="/images/professionalheadshot.jpg"
            alt="Darren J Paul"
            width={80}
            height={80}
            className="size-full object-cover object-top"
          />
        </div>
        <div className="text-sm leading-tight">
          <p className="font-medium text-foreground">
            <Link href="/about" className="hover:text-accent transition-colors">
              Darren J Paul, PhD
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">
            Sports Performance Coach
            {published && ` · ${published}`}
            {showUpdated && ` · Updated ${updated}`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <aside
      aria-label="About the author"
      className={`rounded-2xl border border-border bg-surface p-6 sm:p-8 ${className}`}
    >
      <div className="flex flex-col sm:flex-row gap-5 sm:gap-6">
        <div className="size-20 sm:size-24 shrink-0 overflow-hidden rounded-2xl">
          <Image
            src="/images/professionalheadshot.jpg"
            alt="Darren J Paul"
            width={192}
            height={192}
            className="size-full object-cover object-top"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] uppercase tracking-[0.25em] text-accent font-medium">About the author</p>
          </div>
          <h3 className="text-lg font-heading font-semibold text-primary">
            <Link href="/about" className="hover:text-accent transition-colors">
              Darren J Paul, PhD
            </Link>
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Sports Performance Coach · CSCS · NASM · USAW Level 2 · Zephyrhills, FL
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Performance strategist, coach, and researcher. 500+ athletes coached across 15+ sports and 3 continents —
            including WTA professionals and pro pickleball players. Author of the Grey Zone coaching philosophy and the
            Five Pillar Framework.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/about"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
            >
              Read full bio
              <ArrowRight className="size-3.5" />
            </Link>
            <span className="h-3.5 w-px bg-border" aria-hidden />
            {linkedInUrl && (
              <a
                href={linkedInUrl}
                target="_blank"
                rel="me noopener noreferrer"
                className="text-muted-foreground hover:text-accent transition-colors"
                aria-label="Darren J Paul on LinkedIn"
              >
                <Linkedin className="size-4" />
              </a>
            )}
            {instagramUrl && (
              <a
                href={instagramUrl}
                target="_blank"
                rel="me noopener noreferrer"
                className="text-muted-foreground hover:text-accent transition-colors"
                aria-label="Darren J Paul on Instagram"
              >
                <Instagram className="size-4" />
              </a>
            )}
          </div>
          {(published || updated) && (
            <p className="mt-4 text-xs text-muted-foreground">
              {published && <>Published {published}</>}
              {showUpdated && <> · Updated {updated}</>}
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}
