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
  /** Advanced items live in the panel's collapsed "Optional extras" section
   *  and NEVER count toward the banner — the owner asked for "basic only"
   *  (2026-08-03): the default view is six plain steps, no plumbing jargon. */
  advanced?: boolean
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
  // Basics first (plain-English, jargon-free), then the advanced extras.
  return [
    {
      key: "gmail_connected",
      title: "Connect Gmail",
      why: "Lets the app read emailed receipts and show your inbox.",
      status: s.gmailConnected ? "done" : "todo",
      href: "/admin/inbox",
    },
    {
      key: "income_sync",
      title: "Auto-record your Stripe income",
      why: "Money paid through the site lands in the books every night — card fees included.",
      status: offSyncs.length === 0 ? "done" : "todo",
      detail: offSyncs.length ? `Still off: ${offSyncs.join(" and ")}.` : undefined,
      href: "/admin/books",
    },
    {
      key: "tax_rate",
      title: "Enter the tax rate from your accountant",
      why: "One number — used to estimate how much tax to set aside as the year goes.",
      status: s.taxRatePercent !== null ? "done" : "todo",
      href: "/admin/books/insights",
    },
    {
      key: "accountant_email",
      title: "Add your accountant's email",
      why: "So reports can be emailed straight to them.",
      status: s.accountantEmail.trim() ? "done" : "todo",
      href: "/admin/books/reports",
    },
    {
      key: "first_statement",
      title: "Upload a bank statement",
      why: "Catches spending that never had a receipt.",
      status: s.statementEntryExists ? "done" : "todo",
      href: "/admin/books",
    },
    {
      key: "categories_reviewed",
      title: "Check your expense categories",
      why: "Make sure the category list fits how you actually spend.",
      status: has(s.manualChecks, "categories_reviewed") ? "done" : "todo",
      href: "/admin/books/accounts",
      manual: true,
    },
    {
      key: "email_receipts_cron",
      title: "Automatic email-receipt reading",
      why: "Checks Gmail every hour for new receipts.",
      status: s.flags.gmailReceipts ? "done" : "todo",
      href: "/admin/books/email-receipts",
      advanced: true,
    },
    {
      key: "forwarders",
      title: "Receipt forwarding addresses",
      why: "Emails from these addresses are read automatically.",
      status: forwarderCount > 0 ? "done" : "todo",
      href: "/admin/books/email-receipts",
      advanced: true,
    },
    {
      key: "gmail_label",
      title: "Gmail label for old receipts",
      why: "Put the DJP Receipts label on any old email in Gmail and it gets pulled into the books. New receipts don't need this.",
      status: labelStatus,
      detail:
        labelStatus === "attention"
          ? "Can't check yet — the hourly email check hasn't run."
          : labelStatus === "todo"
            ? "There's no label called DJP Receipts in your Gmail yet — create one there to use this."
            : undefined,
      href: "/admin/books/email-receipts",
      advanced: true,
    },
    {
      key: "quarterly_pack",
      title: "Quarterly email to your accountant",
      why: "Sends them a full report pack every three months.",
      status: s.flags.quarterlyPack ? "done" : "todo",
      href: "/admin/books/reports",
      advanced: true,
    },
    {
      key: "housekeeping",
      title: "Automatic cleanup",
      why: "Tidies old receipt files and flags stuck ones.",
      status: offHousekeeping.length === 0 ? "done" : "todo",
      detail: offHousekeeping.length ? `Still off: ${offHousekeeping.join(" and ")}.` : undefined,
      href: "/admin/books",
      advanced: true,
    },
  ]
}
