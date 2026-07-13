import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import {
  Ticket,
  QrCode,
  Repeat,
  Users2,
  CalendarClock,
  Ban,
  Link2,
  Sparkles,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export const metadata = { title: "How-to Guide" }

const SECTIONS: { id: string; label: string }[] = [
  { id: "packs", label: "Selling session packs" },
  { id: "payment-links", label: "Payment links" },
  { id: "checkins", label: "Check-ins" },
  { id: "memberships", label: "Memberships" },
  { id: "family", label: "Family billing" },
  { id: "schedule", label: "Schedule" },
  { id: "fees", label: "No-show & late-cancel fees" },
  { id: "ai", label: "AI program generation" },
]

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="bg-white rounded-xl border border-border p-6 scroll-mt-6">
      <h2 className="font-heading text-lg font-semibold text-primary flex items-center gap-2 mb-3">
        <Icon className="size-5" strokeWidth={1.5} />
        {title}
      </h2>
      <div className="space-y-3 text-sm text-foreground leading-relaxed">{children}</div>
    </section>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex-none flex items-center justify-center size-6 rounded-full bg-primary/10 text-primary text-xs font-semibold mt-0.5">
        {n}
      </span>
      <p>{children}</p>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-accent/10 border border-accent/30 px-3 py-2 text-sm">
      <span className="font-semibold">Tip:</span> {children}
    </p>
  )
}

export default async function AdminGuidePage() {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">How-to Guide</h1>
        <p className="text-sm text-muted-foreground">
          How the day-to-day tools work — packs, check-ins, memberships, family billing, the schedule, and fees.
        </p>
      </div>

      <nav className="bg-white rounded-xl border border-border p-4 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary transition-colors"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <Section id="packs" icon={Ticket} title="Selling session packs">
        <Step n={1}>
          Open the client&apos;s page (<Link href="/admin/clients" className="text-primary underline">Clients</Link> →
          pick the client) and hit <strong>Sell pack</strong> in the Session Packs box.
        </Step>
        <Step n={2}>
          Pick a pack from your catalogue, or use <strong>Custom</strong> for a one-off (session type, number of
          sessions, price). Optionally link an online program — then every check-in also ticks off the next workout in
          that program.
        </Step>
        <Step n={3}>
          Choose how they pay: <strong>Card (Stripe link)</strong> creates a payment link you send to them;{" "}
          <strong>Cash / paid offline</strong> and <strong>Complimentary</strong> add the pack immediately with no
          payment step.
        </Step>
        <p>
          A pack sold by card shows <strong>awaiting payment</strong> until the client pays through the link, then it
          flips to paid on its own. The client can train on it in the meantime — you&apos;ll see the badge as a
          reminder to chase payment.
        </p>
        <Tip>
          Sold a test pack or made a mistake? Use the <strong>trash icon</strong> on the pack to delete it. Deleting an
          unpaid pack also kills its payment link.
        </Tip>
        <p>
          Your standard pack catalogue lives at{" "}
          <Link href="/admin/session-packs/products" className="text-primary underline">
            Business → Session Packs
          </Link>
          . Packs there can also be bought by clients themselves from their portal.
        </p>
      </Section>

      <Section id="payment-links" icon={Link2} title="Payment links — the right way to use them">
        <p>
          When you create a card payment link, <strong>copy it and send it to the client</strong> (WhatsApp, text,
          email — whatever you normally use). The link is addressed to the client&apos;s email, so when they open it,
          their own saved card comes up.
        </p>
        <p>
          <strong>Don&apos;t pay through the link yourself.</strong> If you open it just to look, that&apos;s fine —
          but anything you pay there goes through as a real payment.
        </p>
        <p>
          Lost the link? Every awaiting-payment pack has a <strong>Copy payment link</strong> button on the
          client&apos;s page. Links expire after 24 hours — if that happens, the same button just makes a fresh one.
        </p>
      </Section>

      <Section id="checkins" icon={QrCode} title="Check-ins (using up pack sessions)">
        <p>Each check-in uses one session from the client&apos;s oldest active pack. Three ways to do it:</p>
        <Step n={1}>
          <strong>You tap it:</strong> the <strong>Check in</strong> button at the top of the client&apos;s page.
        </Step>
        <Step n={2}>
          <strong>They scan a QR:</strong> the QR dialog in the header of the{" "}
          <Link href="/admin/clients" className="text-primary underline">
            Clients list
          </Link>{" "}
          — put it on the gym wall; clients scan and check themselves in.
        </Step>
        <Step n={3}>
          <strong>Their personal link:</strong> each client also has a stable personal check-in link you can share once
          (find it in the same dialog).
        </Step>
        <p>
          Mis-tapped? Every check-in has an <strong>Undo</strong> next to it on the client&apos;s page — the credit
          comes straight back.
        </p>
        <Tip>
          If the pack is linked to a program, checking in also marks that day&apos;s workout complete — you&apos;ll see
          a 🎟 badge on the client&apos;s assigned program.
        </Tip>
      </Section>

      <Section id="memberships" icon={Repeat} title="Memberships (auto-withdrawal)">
        <p>
          Memberships charge the client&apos;s saved card automatically on a schedule — good for &quot;X sessions per
          month&quot; or flat monthly coaching.
        </p>
        <Step n={1}>
          Create your plans at{" "}
          <Link href="/admin/memberships/plans" className="text-primary underline">
            Business → Memberships
          </Link>
          .
        </Step>
        <Step n={2}>
          On the client&apos;s page, pick the plan and hit <strong>Start membership</strong>. They need a saved card
          first (Card on file section — send them the save-card link).
        </Step>
        <p>Cancel any time from the same spot; Stripe stops future charges immediately.</p>
      </Section>

      <Section id="family" icon={Users2} title="Family billing (one payer for the household)">
        <p>
          If dad pays for his wife and son: open the family member&apos;s client page and set{" "}
          <strong>&quot;Charges paid by&quot;</strong> to the payer. From then on, that person&apos;s no-show fees and
          memberships charge the payer&apos;s card instead of their own.
        </p>
        <p>It only goes one hop (son → dad, never son → dad → grandad), and if the payer has no card it falls back safely to the client themselves.</p>
      </Section>

      <Section id="schedule" icon={CalendarClock} title="Schedule (recurring weekly sessions)">
        <p>
          <Link href="/admin/schedule" className="text-primary underline">
            Coaching → Schedule
          </Link>{" "}
          shows your week — Month, Week and List views. Standing weekly slots (e.g. &quot;Marcus, Mondays 5:45am&quot;)
          generate the upcoming sessions automatically.
        </p>
        <Step n={1}>Add a standing slot on the client&apos;s page (day + time + Add).</Step>
        <Step n={2}>
          Each session on the schedule can be marked <strong>attended</strong>, <strong>no-show</strong>,{" "}
          <strong>cancelled</strong>, or rescheduled — click the session chip.
        </Step>
        <p>
          Marking <strong>attended</strong> deducts a pack session automatically (same as a check-in). A standing slot
          can also advance a linked online program via its <strong>&quot;Advances program&quot;</strong> setting.
        </p>
      </Section>

      <Section id="fees" icon={Ban} title="No-show & late-cancel fees">
        <p>
          Set fee amounts at{" "}
          <Link href="/admin/sessions/fees" className="text-primary underline">
            Business → Session Fees
          </Link>
          . While amounts are $0 nothing is ever charged. Once set, marking a session no-show (or a late cancel inside
          your cut-off window) charges the client&apos;s saved card — or their family payer&apos;s card if one is set.
        </p>
        <p>
          Every charge is listed on the client&apos;s page and in{" "}
          <Link href="/admin/payments" className="text-primary underline">
            Payments
          </Link>
          . To switch fees off entirely, zero the amounts (or ask to disable the feature flag).
        </p>
      </Section>

      <Section id="ai" icon={Sparkles} title="AI program generation — exercise pools">
        <p>
          When generating a day or week with a <strong>strict exercise pool</strong>, the AI now builds the day from
          whatever your pool actually covers — it no longer fails with &quot;Exercise Pool too small&quot; when your
          pool is missing a movement pattern like carry or locomotion. It picks the closest pattern your pool has
          instead.
        </p>
        <Tip>
          Strict mode = only your pool exercises, ever. Preferred mode = your pool first, full library as backup. If
          you want variety across a long program, Preferred usually gives better results with small pools.
        </Tip>
      </Section>
    </div>
  )
}
