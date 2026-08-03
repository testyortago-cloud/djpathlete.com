// Auto-detected accounting setup checklist (spec: 2026-08-03-books-setup-checklist-tour-design.md).
// Pure compute over already-fetched state — zero IO here; the API route gathers sources.
// "attention" = cannot verify (e.g. the gmail cron has never run), rendered amber.

export interface SetupItem {
  key: string
  title: string
  why: string
  status: "done" | "todo" | "attention"
  detail?: string
  href: string
  manual?: boolean
}

export interface SetupStatusSources {
  gmailConnected: boolean
  /** detail of the latest bookkeepingGmailReceiptsCron run; null = never ran. */
  latestGmailCronDetail: Record<string, unknown> | null
  forwarders: unknown
  flags: {
    gmailReceipts: boolean
    incomeSync: boolean
    payoutSync: boolean
    retention: boolean
    receiptWatchdog: boolean
    quarterlyPack: boolean
  }
  taxRatePercent: number | null
  accountantEmail: string
  statementEntryExists: boolean
  manualChecks: unknown
}

export const MANUAL_CHECK_KEYS = ["categories_reviewed"] as const

function has(list: unknown, key: string): boolean {
  return Array.isArray(list) && list.includes(key)
}

export function computeSetupItems(s: SetupStatusSources): SetupItem[] {
  const forwarderCount = Array.isArray(s.forwarders)
    ? s.forwarders.filter((f) => typeof f === "string" && f.trim()).length
    : 0
  const labelStatus: SetupItem["status"] =
    s.latestGmailCronDetail === null
      ? "attention"
      : s.latestGmailCronDetail.label_missing
        ? "todo"
        : "done"
  const offSyncs = [
    ...(s.flags.incomeSync ? [] : ["income sync"]),
    ...(s.flags.payoutSync ? [] : ["payout sync"]),
  ]
  const offHousekeeping = [
    ...(s.flags.retention ? [] : ["retention"]),
    ...(s.flags.receiptWatchdog ? [] : ["receipt watchdog"]),
  ]
  return [
    {
      key: "gmail_connected",
      title: "Connect Gmail",
      why: "Powers the inbox and automatic email-receipt ingestion.",
      status: s.gmailConnected ? "done" : "todo",
      href: "/admin/inbox",
    },
    {
      key: "gmail_label",
      title: "Create the receipt label in Gmail",
      why: "The poller backfills anything you label — the opt-in path for old receipts.",
      status: labelStatus,
      detail:
        labelStatus === "attention"
          ? "The email-receipts cron hasn't run yet, so the label can't be verified."
          : labelStatus === "todo"
            ? "The last cron run reported the label missing in the connected mailbox."
            : undefined,
      href: "/admin/books/email-receipts",
    },
    {
      key: "forwarders",
      title: "Add receipt forwarder addresses",
      why: "Mail from (or to) these addresses is ingested automatically — no labeling needed.",
      status: forwarderCount > 0 ? "done" : "todo",
      href: "/admin/books/email-receipts",
    },
    {
      key: "email_receipts_cron",
      title: "Turn on email-receipt ingestion",
      why: "The hourly poll that reads receipts out of Gmail.",
      status: s.flags.gmailReceipts ? "done" : "todo",
      href: "/admin/books/email-receipts",
    },
    {
      key: "income_sync",
      title: "Turn on platform income sync",
      why: "Nightly sync of Stripe income and payout fees into the ledger.",
      status: offSyncs.length === 0 ? "done" : "todo",
      detail: offSyncs.length ? `Off: ${offSyncs.join(", ")}.` : undefined,
      href: "/admin/books",
    },
    {
      key: "tax_rate",
      title: "Set your safe-harbor tax rate",
      why: "Your CPA's effective rate drives the rolling tax forecast — without it there is no estimate.",
      status: s.taxRatePercent !== null ? "done" : "todo",
      href: "/admin/books/insights",
    },
    {
      key: "accountant_email",
      title: "Set your accountant's email",
      why: "Where report packs and the quarterly close email go.",
      status: s.accountantEmail.trim() ? "done" : "todo",
      href: "/admin/books/reports",
    },
    {
      key: "quarterly_pack",
      title: "Turn on the quarterly accountant pack",
      why: "Emails your accountant a full pack each quarter (needs the email above).",
      status: s.flags.quarterlyPack ? "done" : "todo",
      href: "/admin/books/reports",
    },
    {
      key: "housekeeping",
      title: "Turn on receipt housekeeping",
      why: "Retention pruning and the stuck-receipt watchdog.",
      status: offHousekeeping.length === 0 ? "done" : "todo",
      detail: offHousekeeping.length ? `Off: ${offHousekeeping.join(", ")}.` : undefined,
      href: "/admin/books",
    },
    {
      key: "first_statement",
      title: "Import your first bank statement",
      why: "Statements catch every expense that never had a receipt.",
      status: s.statementEntryExists ? "done" : "todo",
      href: "/admin/books",
    },
    {
      key: "categories_reviewed",
      title: "Review expense categories per book",
      why: "Each book is its own tax context — check the category list fits before bulk-importing.",
      status: has(s.manualChecks, "categories_reviewed") ? "done" : "todo",
      href: "/admin/books/accounts",
      manual: true,
    },
  ]
}
