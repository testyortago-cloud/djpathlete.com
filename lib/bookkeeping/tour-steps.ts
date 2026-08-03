// Cross-page tour over the accounting area. Steps MUST stay contiguous per
// page (the sessionStorage resume navigates on page boundaries). Target
// elements carry data-tour="<id>" (wired in the six client components).
export interface BooksTourStep {
  id: string
  page: string
  title: string
  body: string
}

export const BOOKS_TOUR_STEPS: BooksTourStep[] = [
  { id: "toolbar", page: "/admin/books", title: "Getting money into the ledger",
    body: "Every ingestion path lives here: manual entries, platform income, bank statements, cash receipts, photo/PDF receipts, and Amazon order history." },
  { id: "find-duplicates", page: "/admin/books", title: "Duplicate scan",
    body: "AI reviews same-amount pairs (like a vendor invoice and its paid receipt) and helps you delete the extra one safely." },
  { id: "filters", page: "/admin/books", title: "Slice the ledger",
    body: "Filter by period, category, source, or search memo and counterparty. Filters survive in the URL, so you can share a view." },
  { id: "ledger", page: "/admin/books", title: "The ledger itself",
    body: "Each row shows the memo (or the receipt's business purpose in italics), its category, source, and amount. The paperclip opens the attached document; the pencil edits." },
  { id: "email-chip", page: "/admin/books", title: "Email receipts, waiting",
    body: "When the Gmail poller finds receipts, the pending count appears here — one click into the review board." },
  { id: "accounts", page: "/admin/books/accounts", title: "Categories per book",
    body: "Each book keeps its own chart of expense categories — its own tax context. Categories marked 'business purpose required' force substantiation before posting." },
  { id: "reports", page: "/admin/books/reports", title: "Reports",
    body: "P&L, category breakdowns, and the exportable accountant pack (QuickBooks CSV + spreadsheet + print view) live here." },
  { id: "accountant", page: "/admin/books/reports", title: "Your accountant, on autopilot",
    body: "Set your accountant's email and the quarterly cron emails them a full pack after each quarter closes." },
  { id: "insights", page: "/admin/books/insights", title: "Insights & watchdogs",
    body: "Deduction finder, anomaly checks, and duplicate findings surface here. Dismissing a finding hides it from every future run." },
  { id: "tax", page: "/admin/books/insights", title: "The tax forecast",
    body: "Enter the effective rate your CPA gives you and this tracks estimated tax against year-to-date net, with the next safe-harbor date." },
  { id: "assets", page: "/admin/books/assets", title: "Assets & depreciation",
    body: "Big purchases become assets with a depreciation schedule your accountant can use instead of a same-year expense." },
  { id: "email-board", page: "/admin/books/email-receipts", title: "The email-receipts board",
    body: "Receipts pulled from Gmail land here in three columns: ready to post, needs a look, and possible duplicates." },
  { id: "email-post", page: "/admin/books/email-receipts", title: "Review, pick a book, post",
    body: "Each card shows what the AI read. Check the amount, choose which book it posts into, then Post — or Ignore what doesn't belong." },
]
