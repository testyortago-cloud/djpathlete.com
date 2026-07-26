/**
 * The walkthrough narration — single source of truth for BOTH the recorder
 * (how long to dwell on each screen) and the Remotion edit (what caption to
 * draw, and when).
 *
 * Timing is derived from the words, not guessed: the recorder holds each beat
 * for `ms(text)`, so the footage is exactly as long as the narration needs.
 * That is why the first cut came out at 2.7 minutes — the dwell times were
 * invented instead of derived.
 *
 * A beat is either:
 *   { text }            — hold on the current screen while the caption reads
 *   { text, do }        — run `do(page)` first, then hold for the caption
 *   { text, with }      — hold while `with(page)` runs concurrently (scrolling)
 */

/** ~2.6 words/sec reading pace, with a floor so short lines still land. */
export function captionMs(text) {
  const words = text.trim().split(/\s+/).length
  return Math.max(2600, Math.round((words / 2.6) * 1000) + 700)
}

export const CHAPTERS = [
  {
    id: "01-problem",
    title: "The problem",
    url: "/admin/books",
    beats: [
      { text: "Every coaching business runs on money it barely tracks. Card receipts in a glovebox, Stripe payouts in one tab, a bank statement nobody opens until April." },
      { text: "This is the AI Bookkeeper. It turns all of that into one ledger you can hand to an accountant — without you doing data entry." },
      { text: "Everything you're about to see is real software running on real data. Nothing here is a mockup." },
    ],
  },
  {
    id: "02-three-books",
    title: "The three books",
    url: "/admin/books",
    beats: [
      { text: "Start with the ledger. Income on the left, expenses in the middle, and what's actually yours on the right." },
      { text: "There are three separate books. Keeping business and household money apart is the single thing accountants ask for most." },
      { text: "This is the spouse's business — its own books, its own totals, never mixed in.", tab: "Spouse — Business" },
      { text: "And the household book. Personal spending lives here, which matters later when we calculate a home-office deduction.", tab: "Household & Personal" },
      { text: "Back to the main business book. Every number you'll see from here is scoped to whichever book is selected.", tab: "Darren — DJP Athlete" },
    ],
  },
  {
    id: "03-income",
    title: "Income, automatically",
    url: "/admin/books",
    beats: [
      { text: "Income is the easy half, because the platform already knows about it — session packs, camps, memberships, shop orders." },
      { text: "Import platform income pulls straight from the money-of-record tables and drafts ledger entries for review.", click: /import platform income/i },
      { text: "It matches each payment to the right service line, so revenue is categorised before you ever look at it." },
      { text: "And a nightly job runs this automatically at 4:30 UTC — so new payments post themselves while you sleep.", esc: true },
    ],
  },
  {
    id: "04-statements",
    title: "Bank statements",
    url: "/admin/books",
    beats: [
      { text: "Expenses are the hard half. This is where most bookkeeping tools ask you to type. This one doesn't." },
      { text: "Upload a bank or card statement — CSV or PDF — and the AI reads every row.", click: /import statement/i },
      { text: "It proposes a category for each line, flags internal transfers so they never hit your profit and loss, and catches duplicates." },
      { text: "Crucially it never posts anything silently. You review, you uncheck what's wrong, and only then does it commit.", esc: true },
      { text: "Here are the rows that came in from statements — tagged at the source, so you always know where a number came from." },
    ],
  },
  {
    id: "05-receipts",
    title: "Receipts, four ways",
    url: "/admin/books",
    beats: [
      { text: "A statement tells you money left. A receipt proves what it bought. The IRS cares about the difference." },
      { text: "Paid cash? Two taps. Amount, category, done — no photo required.", click: /add cash receipt/i },
      { text: "Got a paper receipt? Photograph it. Vision AI reads the vendor, the date and the total, then drops it into a review queue.", esc: true, then: /upload receipt/i },
      { text: "You can shoot up to fifteen at once — a whole shoebox in a single pass.", esc: true },
      { text: "Amazon is its own special misery, so it gets its own importer that reads the order CSV directly.", click: /import amazon/i },
      { text: "And the fourth way needs no app at all.", esc: true },
      { text: "Label a receipt email in Gmail, and an hourly job collects the attachment, scans it, and queues it here.", url: "/admin/books/email-receipts" },
      { text: "It's read-only against your inbox — it never marks mail read, never moves anything, never deletes." },
    ],
  },
  {
    id: "06-categories",
    title: "Categories & business purpose",
    url: "/admin/books/accounts",
    beats: [
      { text: "Categories are your chart of accounts. Each one carries a tax category, so the report at the end is already in your accountant's language." },
      { text: "Some categories demand more. Meals, travel and vehicle require a stated business purpose — because those are the deductions that get challenged.", scroll: 0.35 },
      { text: "Write down why a lunch was a business lunch at the time, and you'll still have the answer eighteen months later.", scroll: 0.7 },
    ],
  },
  {
    id: "07-payouts",
    title: "Stripe payouts & net revenue",
    url: "/admin/books/reports",
    beats: [
      { text: "Now the part almost every coaching business gets wrong: the difference between what clients paid and what actually landed." },
      { text: "Stripe takes a fee on every charge. Your gross income and your real income are not the same number.", scroll: 0.3 },
      { text: "A daily job pulls every payout and its underlying transactions, so fees are read from Stripe rather than estimated." },
      { text: "Gross stays the headline — that's what your accountant files on. Underneath it, the fees, and the net you actually received.", scroll: 0.45 },
      { text: "If a payout hasn't been ingested yet, this line says so plainly instead of quietly showing zero fees." },
    ],
  },
  {
    id: "08-insights",
    title: "Insights",
    url: "/admin/books/insights",
    beats: [
      { text: "This is where it stops being a ledger and starts being a bookkeeper." },
      { text: "Every finding here is a candidate for your accountant to confirm — never a filed decision. That distinction is deliberate.", scroll: 0.12 },
      { text: "The deduction watchlist totals what you've spent in each deductible category, with the vendors behind it.", scroll: 0.22 },
      { text: "Substantiation gaps are the dangerous ones: money spent in a category that legally needs a stated purpose, with no purpose written down.", scroll: 0.34 },
      { text: "Uncategorized expenses can't be matched to a deduction at all. Until you categorise them, they're invisible money.", scroll: 0.45 },
      { text: "Profit by service line shows which part of the business actually makes money — camps versus team work versus one-to-one training.", scroll: 0.56 },
      { text: "Costs that don't belong to one line sit in a shared bucket. Turn on allocation and they're split by each line's share of revenue.", scroll: 0.63, toggle: /allocate shared costs/i },
      { text: "The vendor sweep finds recurring charges. These two are both video tools on the same category — flagged as a possible overlap you're paying twice for.", scroll: 0.72 },
      { text: "Missing receipts and purposes is the pre-audit checklist: every entry that would be hard to defend, listed in one place.", scroll: 0.82 },
      { text: "A rolling tax forecast estimates what to set aside, using your own rate.", scroll: 0.9 },
      { text: "And home-office allocation reads your household rent and utilities, then proposes a business share — a proposal, not a filing.", scroll: 0.97 },
      { text: "Anything you disagree with, dismiss. It stays dismissed even as the numbers underneath keep changing." },
    ],
  },
  {
    id: "09-close",
    title: "Monthly close",
    url: "/admin/books",
    beats: [
      { text: "When a month is done, close it. That freezes its totals — no edits, no imports, no accidental changes to a number you've already reported." },
      { text: "Closed months show here with the option to reopen if something genuinely needs correcting." },
      { text: "It's record-keeping, not filing. Your accountant still files — this just means the ground stops moving under them." },
    ],
  },
  {
    id: "10-reports",
    title: "Reports & the accountant pack",
    url: "/admin/books/reports",
    beats: [
      { text: "At the end of the quarter, everything comes out in the formats an accountant actually wants." },
      { text: "A QuickBooks-ready CSV. A full Excel pack with profit and loss, income by service line, depreciation, and a document index." },
      { text: "Or a print view for a PDF. And the pack can be emailed to your accountant automatically, every quarter, without you remembering.", url: "/admin/books/reports/print" },
      { text: "Same numbers as the screen, laid out for someone who's never seen this software.", scroll: 0.4 },
    ],
  },
  {
    id: "11-assets",
    title: "Assets & depreciation",
    url: "/admin/books/assets",
    beats: [
      { text: "Big purchases aren't expenses — they're assets that depreciate over years. Force plates, camera rigs, a turf build-out." },
      { text: "Record it once with its in-service date and useful life, and the depreciation schedule writes itself into the accountant pack.", scroll: 0.4 },
    ],
  },
  {
    id: "12-wrap",
    title: "Automation & wrap",
    url: "/admin/books",
    beats: [
      { text: "Most of this runs without you. Income posts nightly. Receipts arrive hourly from your inbox. Payouts and fees sync daily." },
      { text: "A watchdog emails you if a receipt is missing for too long, and the quarterly pack goes to your accountant on schedule." },
      { text: "What's left for you is the judgement: categorise what's ambiguous, write down why, and confirm what the AI proposes." },
      { text: "That's the AI Bookkeeper." },
    ],
  },
]

export const TOTAL_MS = CHAPTERS.reduce(
  (a, c) => a + c.beats.reduce((b, x) => b + captionMs(x.text), 0),
  0,
)
