import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import {
  ArrowLeft,
  BookOpen,
  Banknote,
  BarChart3,
  Calculator,
  Camera,
  CheckCircle2,
  FolderTree,
  Lightbulb,
  ListChecks,
  Lock,
  Mail,
  Package,
  Plus,
  ScanSearch,
  ShoppingCart,
  SlidersHorizontal,
  Upload,
  Wallet,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export const metadata = { title: "How to use Accounting" }

// Screenshots are captured from the real UI (see docs note in the journal) and
// live in public/guide/books/. Dimensions are the actual pixel sizes so
// next/image reserves the right space and nothing shifts on load.
const SHOTS = {
  tabs: { w: 593, h: 80 },
  stats: { w: 1325, h: 153 },
  tax: { w: 1325, h: 101 },
  close: { w: 1325, h: 425 },
  toolbar: { w: 1325, h: 76 },
  "setup-banner": { w: 1325, h: 81 },
  "setup-panel": { w: 619, h: 682 },
  filters: { w: 1325, h: 126 },
  ledger: { w: 1325, h: 584 },
  "add-entry": { w: 475, h: 559 },
  "import-platform": { w: 706, h: 231 },
  "import-statement": { w: 475, h: 262 },
  "cash-receipt": { w: 475, h: 413 },
  "upload-receipt": { w: 475, h: 342 },
  "import-amazon": { w: 475, h: 262 },
  duplicates: { w: 706, h: 154 },
  "email-receipts": { w: 1200, h: 833 },
  reports: { w: 1200, h: 1137 },
  insights: { w: 1200, h: 1137 },
  assets: { w: 1200, h: 833 },
  categories: { w: 1200, h: 1137 },
} as const

type ShotName = keyof typeof SHOTS

const SECTIONS: { id: string; label: string }[] = [
  { id: "books", label: "Your three books" },
  { id: "numbers", label: "The top numbers" },
  { id: "tax", label: "Tax estimate" },
  { id: "setup", label: "Setup checklist" },
  { id: "add-entry", label: "Add an entry by hand" },
  { id: "import-platform", label: "Import platform income" },
  { id: "import-statement", label: "Import a bank statement" },
  { id: "cash-receipt", label: "Cash receipt" },
  { id: "upload-receipt", label: "Photograph a receipt" },
  { id: "import-amazon", label: "Import Amazon orders" },
  { id: "email-receipts", label: "Email receipts" },
  { id: "duplicates", label: "Find duplicates" },
  { id: "ledger", label: "Filters & the ledger" },
  { id: "close", label: "Closing a month" },
  { id: "reports", label: "Reports & accountant pack" },
  { id: "insights", label: "Insights" },
  { id: "assets", label: "Equipment & assets" },
  { id: "categories", label: "Categories" },
  { id: "routine", label: "A monthly routine" },
]

function Shot({ name, alt, caption }: { name: ShotName; alt: string; caption?: string }) {
  const { w, h } = SHOTS[name]
  return (
    <figure className="my-4">
      {/* maxWidth pins each shot to its own pixel width: a 513px dialog capture
          stretched to the full column just looks blurry. Wide captures still
          scale DOWN via w-full. */}
      <div
        className="overflow-hidden rounded-lg border border-border bg-surface"
        style={{ maxWidth: `${w}px` }}
      >
        <Image
          src={`/guide/books/${name}.png`}
          alt={alt}
          width={w}
          height={h}
          sizes="(max-width: 900px) 100vw, 860px"
          className="h-auto w-full"
        />
      </div>
      {caption ? <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  )
}

function Section({
  id,
  icon: Icon,
  title,
  lede,
  children,
}: {
  id: string
  icon: LucideIcon
  title: string
  lede?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6 rounded-xl border border-border bg-white p-6">
      <h2 className="mb-1 flex items-center gap-2 font-heading text-lg font-semibold text-primary">
        <Icon className="size-5" strokeWidth={1.5} />
        {title}
      </h2>
      {lede ? <p className="mb-3 text-sm text-muted-foreground">{lede}</p> : null}
      <div className="space-y-3 text-sm leading-relaxed text-foreground">{children}</div>
    </section>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <p>{children}</p>
    </div>
  )
}

/** The one thing that trips people up in this section. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border-l-2 border-accent bg-accent/5 py-2 pl-3 text-sm text-foreground">{children}</p>
  )
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-primary">{children}</span>
}

export default async function BooksGuidePage() {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login?callbackUrl=/admin/books/guide")

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/books"
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            Back to Accounting
          </Link>
          <h1 className="font-heading text-2xl text-primary">How to use Accounting</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every screen in the ledger, in the order you would actually use them. Screens below are the real app.
          </p>
        </div>
      </div>

      <nav className="rounded-xl border border-border bg-white p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">On this page</p>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-sm text-foreground underline-offset-2 hover:text-accent hover:underline">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section
        id="books"
        icon={BookOpen}
        title="Your three books"
        lede="Each book is a separate tax context. Nothing crosses between them."
      >
        <Shot name="tabs" alt="Book switcher showing Darren — DJP Athlete, Spouse — Business, Household & Personal" />
        <p>
          <B>Darren — DJP Athlete</B> is the coaching business: everything that belongs on your Schedule C.{" "}
          <B>Spouse — Business</B> is a second self-employed business kept apart so its profit and loss never mixes with
          yours. <B>Household &amp; Personal</B> is for money that is genuinely not a business expense.
        </p>
        <p>
          Switching tabs switches everything below it — totals, ledger, close, reports. The month you close in one book
          has no effect on the others.
        </p>
        <Note>
          Put a cost in Household if it is personal. Deleting it later is fine, but a personal cost sitting in the
          business book quietly inflates your deductions until someone notices at tax time.
        </Note>
      </Section>

      <Section id="numbers" icon={Wallet} title="The top numbers" lede="Income, expenses and net for whatever the filters currently show.">
        <Shot name="stats" alt="Income, Expenses and Net cards" />
        <p>
          These three cards are also buttons. Click <B>Income</B> to filter the ledger to money in, <B>Expenses</B> for
          money out, <B>Net</B> to go back to everything. The card shows a &ldquo;filtering&rdquo; badge while it is
          active.
        </p>
        <p>They always reflect the current filters — change the period below and these change with it.</p>
      </Section>

      <Section id="tax" icon={Calculator} title="Tax estimate" lede="One number from your accountant turns the ledger into a set-aside figure.">
        <Shot name="tax" alt="Tax estimate strip asking for the rate from your accountant" />
        <Step n={1}>
          Ask your accountant for your flat effective tax rate — one percentage that covers federal income tax plus
          self-employment tax.
        </Step>
        <Step n={2}>
          Type it into <B>Rate %</B> and press <B>Save</B>. The strip turns into a running &ldquo;set aside about $X&rdquo;
          estimate with your next quarterly date.
        </Step>
        <Step n={3}>
          <B>Details</B> opens Insights, where the full year-to-date maths is shown.
        </Step>
        <Note>
          Florida has no state income tax, so this is federal only. It is a planning number for deciding what to move to
          savings — your CPA still files.
        </Note>
      </Section>

      <Section id="setup" icon={ListChecks} title="Setup checklist" lede="Detected automatically from your settings. Nothing here blocks the ledger.">
        <Shot name="setup-banner" alt="Accounting setup banner showing 2 of 6 steps done" />
        <p>
          Click <B>See what&apos;s left</B> (or the <B>?</B> button on the toolbar) to open the full panel, grouped into
          To do, Needs attention and Done.
        </p>
        <Shot name="setup-panel" alt="Accounting setup panel listing outstanding steps" />
        <p>
          It covers connecting Gmail for receipts, auto-recording Stripe income, your tax rate, your accountant&apos;s
          email, a first bank statement, and your expense categories. The same panel starts the guided tour that walks
          the real screens.
        </p>
      </Section>

      <Section id="add-entry" icon={Plus} title="Add an entry by hand" lede="For anything with no import and no receipt — a cash sale, a bank fee, a correction.">
        <Shot name="toolbar" alt="Accounting toolbar with all import and entry actions" caption="Everything in this section lives on this one toolbar." />
        <Shot name="add-entry" alt="Add entry dialog with direction, amount, date, category, memo" />
        <Step n={1}>
          <B>Add entry</B>, then pick <B>Income</B> or <B>Expense</B>.
        </Step>
        <Step n={2}>Enter the amount and the date the money actually moved — not the date you are typing.</Step>
        <Step n={3}>
          Choose a category. Leaving it blank is allowed, but uncategorized entries block the monthly close.
        </Step>
        <Step n={4}>
          Memo and counterparty are what you will search on later. &ldquo;Northgate Sports Supply — squat rack&rdquo;
          beats &ldquo;equipment&rdquo;.
        </Step>
        <Note>
          Editing an entry that came from an import is limited: amount, date and direction stay locked to what the
          import said, so your ledger cannot silently drift from your bank.
        </Note>
      </Section>

      <Section id="import-platform" icon={Upload} title="Import platform income" lede="Pulls money you have already taken through the app — Stripe checkouts, packs, memberships, events.">
        <Shot name="import-platform" alt="Import platform income dialog with a date range" />
        <Step n={1}>Pick the date range you want to bring in.</Step>
        <Step n={2}>
          Review what it found, then post. Anything already in the ledger is skipped, so running it twice over the same
          range is safe.
        </Step>
        <p>
          The nightly income sync does this for you once it is switched on; this dialog is for backfilling older periods
          or catching up immediately.
        </p>
      </Section>

      <Section id="import-statement" icon={Upload} title="Import a bank statement" lede="The backbone of the expense side — a CSV or PDF from your bank or card.">
        <Shot name="import-statement" alt="Import statement dialog with a file picker" />
        <Step n={1}>Download the statement from your bank as CSV (PDF works too).</Step>
        <Step n={2}>
          Upload it here. Every row is read, then AI proposes a category per row from your existing categories.
        </Step>
        <Step n={3}>
          Check the proposals and post. Rows that match something already in the ledger are flagged rather than
          duplicated — an expense you already entered from a receipt wins over the statement line.
        </Step>
        <Note>
          A month with no statement rows gets a warning at close time: spending you never recorded is invisible, and
          invisible spending is a deduction you paid for and did not claim.
        </Note>
      </Section>

      <Section id="cash-receipt" icon={Banknote} title="Cash receipt" lede="Two taps for money that will never appear on a statement.">
        <Shot name="cash-receipt" alt="Add cash receipt dialog" />
        <p>
          Amount, date, category, done. Use it for cash you took or spent — a parent paying cash for a session, parking
          at a clinic, a cash tip to a facility.
        </p>
      </Section>

      <Section id="upload-receipt" icon={Camera} title="Photograph a receipt" lede="A photo or PDF becomes a ledger entry with its document attached.">
        <Shot name="upload-receipt" alt="Upload receipt dialog accepting an image or PDF" />
        <Step n={1}>
          <B>Upload receipt</B>, then drop in a photo (JPEG/PNG/WEBP) or a PDF. You can select several at once.
        </Step>
        <Step n={2}>
          AI reads the vendor, date, total and suggests a category. Correct anything it got wrong — it is a draft, not a
          decision.
        </Step>
        <Step n={3}>Post it. The image stays attached to the entry and is kept for seven years from the date of the spend.</Step>
        <Note>
          To attach a receipt to an entry that <em>already exists</em> (for example a card charge imported from a
          statement), use <B>Attach</B> on the Insights &ldquo;Missing receipts&rdquo; list instead — that keeps one
          entry with a document, rather than creating a second one.
        </Note>
      </Section>

      <Section id="import-amazon" icon={ShoppingCart} title="Import Amazon orders" lede="Amazon's own order history CSV, which itemises what a single card charge actually bought.">
        <Shot name="import-amazon" alt="Import Amazon dialog" />
        <Step n={1}>
          In Amazon, request your order history report and download the CSV.
        </Step>
        <Step n={2}>Upload it here and review the item-level rows, which carry real product names.</Step>
        <Step n={3}>Post the business ones and leave the personal ones out.</Step>
      </Section>

      <Section id="email-receipts" icon={Mail} title="Email receipts" lede="Receipts that arrive by email, collected for you.">
        <Shot name="email-receipts" alt="Email Receipts review board" />
        <p>
          Receipts sent to your connected mailbox — or forwarded to it — are picked up automatically, read, and queued
          here as drafts. The <B>Email Receipts</B> chip on the Accounting header shows how many are waiting.
        </p>
        <p>
          Review each one, fix the category if needed, and post it to the ledger. Anything that is not a receipt gets
          dismissed and never comes back.
        </p>
      </Section>

      <Section id="duplicates" icon={ScanSearch} title="Find duplicates" lede="Catches the same spend recorded twice — the classic receipt-plus-statement pair.">
        <Shot name="duplicates" alt="Duplicate scan dialog reporting a clean ledger" caption="A clean scan. When pairs are found, each one is listed with both entries side by side." />
        <Step n={1}>
          <B>Find duplicates</B> pairs every two entries with the same amount and direction within seven days of each
          other, then asks AI whether each pair is really one transaction recorded twice.
        </Step>
        <Step n={2}>
          Pairs that look like real duplicates are listed for review. <B>Delete</B> removes one side; <B>Not a
          duplicate</B> hides the pair from every future scan.
        </Step>
        <Step n={3}>
          Pairs the AI cleared sit in a collapsed group below with a <B>Dismiss all</B> button.
        </Step>
        <Note>
          The monthly close counts <em>candidate</em> pairs and cannot see AI verdicts — so a pair the AI cleared still
          blocks the month until it is dismissed. <B>Dismiss all</B> is what clears that blocker in one click.
        </Note>
      </Section>

      <Section id="ledger" icon={SlidersHorizontal} title="Filters & the ledger" lede="Finding one entry among hundreds, and fixing it in place.">
        <Shot name="filters" alt="Filter bar with period, category, source and search" />
        <p>
          <B>Period</B> jumps to common ranges (this month, last quarter, this year) or a custom range.{" "}
          <B>Category</B> includes an <B>Uncategorized</B> option — that is the fastest way to clear the close blocker.{" "}
          <B>Source</B> separates manual entries from platform, statement and receipt rows. <B>Search</B> matches memo
          and counterparty.
        </p>
        <Shot name="ledger" alt="Ledger table with date, memo, category, source, amount and actions" />
        <p>
          Category can be changed straight from the row. The paperclip opens the attached receipt or statement. The
          pencil opens the full editor; delete asks first. Long memos are shortened with <B>Show more</B> so one Amazon
          product title cannot push the amounts off screen.
        </p>
      </Section>

      <Section id="close" icon={Lock} title="Closing a month" lede="Freezing a month's totals once you are confident in them.">
        <Shot name="close" alt="Monthly close card with the readiness checklist and blockers" />
        <p>
          Pick the month and the readiness check runs. Two kinds of finding:
        </p>
        <p>
          <B>Blockers</B> (red) mean the frozen number would be wrong — entries with no category, or possible
          duplicates. <B>Warnings</B> (amber) mean it is probably fine but worth a look — missing receipts, no bank
          statement imported, earlier months still open.
        </p>
        <p>
          Each finding has a link that takes you to the fix: <B>Show these entries</B> filters the ledger to the
          uncategorized ones, <B>Show what&apos;s missing</B> opens Insights, <B>Switch to January 2026</B> moves the
          picker to the oldest open month. <B>Re-check</B> re-runs the checks in place and tells you the new verdict —
          it does not leave the page.
        </p>
        <Step n={1}>Clear the blockers, or decide they are fine.</Step>
        <Step n={2}>
          Press <B>Close July 2026</B>. If blockers remain the button stays disabled and <B>Close anyway</B> appears
          instead — it records on the audit trail exactly which blockers you closed over.
        </Step>
        <Step n={3}>
          A closed month is frozen: new entries, edits, deletes and imports into it are refused. Post corrections as an
          adjustment entry in an open month, or <B>Reopen</B> the month — the original frozen totals stay on the audit
          trail either way.
        </Step>
      </Section>

      <Section id="reports" icon={BarChart3} title="Reports & accountant pack" lede="What you hand over at tax time.">
        <Shot name="reports" alt="Reports page with per-book summary, exports, income by service line and profit & loss" />
        <p>
          The <B>per-book summary</B> at the top is all three books side by side for the period. Below it, income is
          broken out by service line (camps, teams, performance training, packs, memberships) and then a full profit and
          loss by category.
        </p>
        <p>
          Three exports: <B>QuickBooks CSV</B> for an accountant who wants to import it, <B>Accountant pack (.xlsx)</B>{" "}
          for a workbook with a tab per book, and <B>Print view</B> for a clean PDF.
        </p>
        <Note>
          Gross figures stay primary. Stripe processing fees appear as a separate estimated line so your income is never
          quietly reported net of fees.
        </Note>
      </Section>

      <Section id="insights" icon={Lightbulb} title="Insights" lede="The chore list — what is missing, what looks off, what a deduction is worth.">
        <Shot name="insights" alt="Insights page with deduction findings and the missing receipts list" />
        <p>
          <B>Missing receipts &amp; purposes</B> lists every expense on a deductible category with no document or no
          business purpose. Each row has <B>Attach</B> to add the receipt directly to that entry, and{" "}
          <B>&times;</B> to dismiss a row you have decided is fine.
        </p>
        <p>
          The other panels surface subscriptions you may be paying twice, vendors you spend the most with, a home-office
          proposal you tune with a percentage, and the full tax estimate maths.
        </p>
        <Note>
          Dismissing is not deleting — a dismissed row is hidden from the list and can be restored from the collapsed
          &ldquo;dismissed&rdquo; group at the bottom of each panel.
        </Note>
      </Section>

      <Section id="assets" icon={Package} title="Equipment & assets" lede="Big purchases that are written off over several years rather than all at once.">
        <Shot name="assets" alt="Equipment and assets register" />
        <Step n={1}>
          Add anything substantial and long-lived — a rack, a sled, a camera, a laptop — with what you paid and the date
          you put it into service.
        </Step>
        <Step n={2}>
          Give it a useful life in years. The register works out the depreciation for each year so your accountant is
          not reconstructing it from receipts.
        </Step>
        <Note>
          Ask your accountant before assuming something is depreciated — plenty of equipment can be expensed in full in
          year one, which is usually better for cash flow.
        </Note>
      </Section>

      <Section id="categories" icon={FolderTree} title="Categories" lede="Your chart of accounts. Everything else in Accounting sorts into these.">
        <Shot name="categories" alt="Chart of accounts with income and expense categories" />
        <p>
          Categories are per book and split into income and expense. Two flags matter: <B>deductible candidate</B> means
          the receipt watchdog will chase a document for entries here, and <B>requires business purpose</B> means it
          will chase a written reason (the one that matters for meals and travel).
        </p>
        <p>
          Keep the list short. Ten categories you use beat forty you guess between, and AI categorization on imports gets
          better the cleaner this list is.
        </p>
      </Section>

      <Section id="routine" icon={CheckCircle2} title="A monthly routine" lede="Roughly twenty minutes, once a month, keeps this current.">
        <Step n={1}>Import last month&apos;s bank and card statements.</Step>
        <Step n={2}>Clear the Email Receipts queue, and photograph any paper receipts still in your bag.</Step>
        <Step n={3}>
          Filter the ledger to <B>Uncategorized</B> and give every row a category.
        </Step>
        <Step n={4}>
          Run <B>Find duplicates</B> and resolve what it finds.
        </Step>
        <Step n={5}>
          Skim Insights for missing receipts and attach what you can.
        </Step>
        <Step n={6}>
          Close the month. If a blocker is genuinely fine, use <B>Close anyway</B> — it is recorded, not hidden.
        </Step>
        <Step n={7}>
          Once a quarter, check the tax set-aside figure and send your accountant the pack from Reports.
        </Step>
      </Section>

      <div className="rounded-xl border border-border bg-white p-6">
        <p className="text-sm text-muted-foreground">
          Prefer to be walked through it in the app? Open Accounting, press the <B>?</B> button on the toolbar and start
          the guided tour — it highlights these same controls on the real screens.
        </p>
        <Link
          href="/admin/books"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft className="size-4" />
          Back to Accounting
        </Link>
      </div>
    </div>
  )
}
