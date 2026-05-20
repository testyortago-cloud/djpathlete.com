import { JsonLd } from "@/components/shared/JsonLd"
import { listFaqsForPage } from "@/lib/db/faqs"
import { buildFaqPageSchema } from "@/lib/seo/build-faq-page-schema"
import type { Faq } from "@/types/database"
import Link from "next/link"

interface ManagedFaqSectionProps {
  pageKey: string
  /** "list" = flat h3 list (athletes-page style); "cards" = details cards. */
  variant?: "list" | "cards"
  eyebrow?: string
  title?: string
  className?: string
}

/**
 * The single FAQ render surface. Fetches published FAQs for `pageKey`,
 * renders them, and auto-emits FAQPage JSON-LD + speakable schema. Renders
 * nothing when a page has no published FAQs. Never throws — a DB failure
 * degrades to an empty render so it cannot take down the host page.
 */
export async function ManagedFaqSection({
  pageKey,
  variant = "list",
  eyebrow = "Common questions",
  title = "Questions, answered.",
  className = "",
}: ManagedFaqSectionProps) {
  let faqs: Faq[] = []
  try {
    faqs = await listFaqsForPage(pageKey, { publishedOnly: true })
  } catch (err) {
    console.error(`[ManagedFaqSection] ${pageKey}:`, err)
    return null
  }
  if (faqs.length === 0) return null

  const schema = buildFaqPageSchema(faqs.map((f) => ({ question: f.question, answer: f.answer })))
  const speakable = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    speakable: { "@type": "SpeakableSpecification", cssSelector: [".faq-q", ".faq-a"] },
  }

  const grouped = faqs.some((f) => f.category)
  const groups = grouped
    ? Array.from(new Set(faqs.map((f) => f.category ?? "Other"))).map((cat) => ({
        cat,
        items: faqs.filter((f) => (f.category ?? "Other") === cat),
      }))
    : [{ cat: null as string | null, items: faqs }]

  return (
    <section className={`mx-auto max-w-3xl px-4 py-16 sm:px-8 lg:py-20 ${className}`}>
      {schema && <JsonLd data={schema} />}
      <JsonLd data={speakable} />

      <div className="mb-8 flex items-center gap-3">
        <div className="h-px w-8 bg-accent" />
        <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">{eyebrow}</span>
      </div>
      <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">{title}</h2>

      {groups.map((g) => (
        <div key={g.cat ?? "_"} className="mt-10">
          {g.cat && (
            <h3 className="mb-4 font-heading text-lg font-semibold text-primary">{g.cat}</h3>
          )}
          {variant === "cards" ? (
            <div className="space-y-3">
              {g.items.map((f) => (
                <details
                  key={f.id}
                  className="group rounded-2xl border border-border bg-white p-6 open:shadow-sm"
                >
                  <summary className="faq-q cursor-pointer list-none font-heading text-base font-semibold text-primary sm:text-lg">
                    {f.question}
                  </summary>
                  <div className="faq-a mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                    {f.answer}
                    {f.link_text && f.link_href && (
                      <p className="mt-2">
                        <Link href={f.link_href} className="font-medium text-primary hover:text-accent">
                          {f.link_text}
                        </Link>
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <dl className="divide-y divide-border">
              {g.items.map((f) => (
                <div key={f.id} className="py-6">
                  <dt className="faq-q font-heading text-lg font-semibold text-primary">{f.question}</dt>
                  <dd className="faq-a mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                    {f.answer}
                    {f.link_text && f.link_href && (
                      <p className="mt-2">
                        <Link href={f.link_href} className="font-medium text-primary hover:text-accent">
                          {f.link_text}
                        </Link>
                      </p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </section>
  )
}
