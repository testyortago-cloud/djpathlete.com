// Why this exists: the two words in this product's marketing area mean specific
// things, and until now nothing said which was which. Everything here is
// answerable from the screens themselves — this page just says it once, plainly.
//
// No role gate. Accounting's guide redirects non-admins because accounting is
// owner-only; this path sits under /admin/funnels, which the middleware already
// gates on the `funnels` permission, so a second check here would only diverge.

import Link from "next/link"
import { ArrowLeft, HelpCircle } from "lucide-react"

export const metadata = { title: "How landing pages and funnels work" }

interface Section {
  id: string
  label: string
  body: string[]
}

const SECTIONS: Section[] = [
  {
    id: "difference",
    label: "A landing page vs a funnel",
    body: [
      "A landing page is one page with one job — capture a lead, sell a program, fill a camp. It lives at /go/<url> and that is the whole thing.",
      "A funnel is more than one page in order, sharing one address: a signup page at /go/<url>, then a payment step at /go/<url>/pay, then a confirmation. Use one when a visitor has to move through stages.",
      "They are separate things: a landing page never turns into a funnel, and a funnel never collapses into a page. If a job needs stages, build it as a funnel from the start.",
    ],
  },
  {
    id: "naming",
    label: "Naming and addresses",
    body: [
      "The name is for you: it labels the page in the list and nobody else sees it.",
      "The URL is public and permanent in practice — once you have shared it or an ad points at it, changing it breaks every link. Pick it deliberately at creation.",
      "A few addresses are reserved because the app already uses them: admin, api, client, go, login and register.",
    ],
  },
  {
    id: "building",
    label: "Building with AI",
    body: [
      "Creating a page drops you into the builder with your description already sent, so a first draft starts immediately. Everything after that is conversation: say what to change and it changes.",
      "The builder works in sections — hero, proof, bullets, steps, testimonial, pricing, FAQ, form, CTA, footer. Asking for a section by name is the fastest way to get one.",
      "Buttons can point at real things in this app: a program, a session pack, an event, or your booking flow. Name the thing and the builder links it.",
    ],
  },
  {
    id: "reviewing",
    label: "Reviewing before you publish",
    body: [
      "The builder checks every button before it lets you publish. A button pointing at a program you have since deleted is reported rather than shipped broken.",
      "The preview is the real page, not a mockup. What you see is what a visitor gets.",
    ],
  },
  {
    id: "live",
    label: "Going live",
    body: [
      "Publishing is two separate things, and this catches people out. Publishing a PAGE saves a version of it. Going LIVE is what makes /go/<url> reachable at all.",
      "Both controls are on the card: publish inside the builder, then Go live on the list. A published page whose funnel is still a draft returns a 404 — that is not a bug, it is the second switch waiting.",
    ],
  },
  {
    id: "leads",
    label: "Where leads land",
    body: [
      "Every form submission on a published page lands in the leads inbox, tagged with the page it came from.",
      "The lead count on each card links straight to that page's leads.",
    ],
  },
]

export default function FunnelsGuidePage() {
  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/pages"
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            Back to Landing pages
          </Link>
          <h1 className="font-heading text-2xl text-primary">How landing pages and funnels work</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The difference between the two, and what it takes to get one in front of people.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <HelpCircle className="size-5 text-accent" />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav className="mb-6 rounded-xl border border-border bg-white p-4 lg:sticky lg:top-4 lg:mb-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">On this page</p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-1">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block py-0.5 text-sm text-foreground underline-offset-2 hover:text-accent hover:underline"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-5">
          {SECTIONS.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-4 rounded-xl border border-border bg-white p-5 shadow-sm"
            >
              <h2 className="flex items-center gap-2.5 font-heading text-base text-primary">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent">
                  {index + 1}
                </span>
                {section.label}
              </h2>
              <div className="mt-3 space-y-2.5 sm:pl-8.5">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}

          <p className="text-sm text-muted-foreground">
            Back to{" "}
            <Link href="/admin/pages" className="underline underline-offset-2 hover:text-primary">
              Landing pages
            </Link>{" "}
            or{" "}
            <Link href="/admin/funnels" className="underline underline-offset-2 hover:text-primary">
              Funnels
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
