import { test, expect } from "@playwright/test"

// Bookkeeper completion (2026-07-25) click-through — kickoff item D(iii).
// The data paths are proven by unit/route tests; these drive the REAL React UIs,
// which had never been exercised in a browser.
//
// Two suites:
//  1. "auth gate" — runs with NO credentials. Proves every bookkeeping route
//     (incl. the new ones) compiles, renders server-side and redirects to /login
//     instead of 500ing. A page with a build/runtime error fails here.
//  2. "authed surfaces" — needs ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD (same
//     convention as admin-events.spec.ts). Skips cleanly when unset.
//
// Screenshots land in test-results/bookkeeping/ for the handoff report.

const adminEmail = process.env.ADMIN_TEST_EMAIL
const adminPassword = process.env.ADMIN_TEST_PASSWORD

const BOOK_ROUTES = [
  "/admin/books",
  "/admin/books/accounts",
  "/admin/books/reports",
  "/admin/books/insights",
  "/admin/books/assets",
  "/admin/books/email-receipts",
] as const

test.describe("Bookkeeping routes — auth gate (no credentials needed)", () => {
  for (const route of BOOK_ROUTES) {
    test(`${route} renders and redirects unauthenticated visitors to /login`, async ({ page }) => {
      const res = await page.goto(route, { waitUntil: "domcontentloaded" })
      // Never a server error: a compile/runtime fault in the page would surface as 5xx.
      expect(res?.status(), `${route} returned ${res?.status()}`).toBeLessThan(500)
      await page.waitForURL(/\/login/, { timeout: 15_000 })
      await expect(page.locator("input[name='email']")).toBeVisible()
    })
  }
})

test.describe("Bookkeeping surfaces — authed click-through", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set (ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD)")

  test.beforeEach(async ({ page }) => {
    await page.goto("/login")
    await page.fill("input[name='email']", adminEmail!)
    await page.fill("input[name='password']", adminPassword!)
    await page.click("button[type='submit']")
    await page.waitForURL(/\/admin/)
  })

  test("ledger loads and honours a deep-link filter (Track B)", async ({ page }) => {
    await page.goto("/admin/books")
    // The page is titled "Accounting" — not "Books"/"Ledger", which is what this
    // assertion originally guessed while the suite was skipping for want of creds.
    await expect(page.getByRole("heading", { name: "Accounting", level: 1 })).toBeVisible()
    await page.screenshot({ path: "test-results/bookkeeping/01-ledger.png", fullPage: true })

    // Deep-link hydration: the uncategorized sentinel must survive into the
    // filter UI. This is the whole point of the insights → ledger links, so it
    // is asserted, not photographed — a server page that silently dropped the
    // sentinel would still produce a perfectly innocent screenshot.
    await page.goto("/admin/books?direction=expense&account_id=none")
    await page.waitForLoadState("networkidle")
    // exact: true — every ledger row's dropdown is labelled "Category for <memo>",
    // so a loose match resolves to dozens of elements.
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue("none")
    // The stat tile's accessible name comes from its content ("Expenses", the
    // amount), not its title attribute — match the title directly instead.
    await expect(page.locator('button[title="Show expense entries only"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await page.screenshot({ path: "test-results/bookkeeping/02-ledger-deeplink.png", fullPage: true })
  })

  test("reports render gross + the net-revenue second line (Track A)", async ({ page }) => {
    await page.goto("/admin/books/reports")
    await page.waitForLoadState("networkidle")
    await expect(page.getByText(/total gross income/i).first()).toBeVisible()
    // Fees line exists even at zero payouts, and must read honestly rather than as a bare $0.00.
    await expect(page.getByText(/stripe processing fees/i).first()).toBeVisible()
    await page.screenshot({ path: "test-results/bookkeeping/03-reports.png", fullPage: true })
  })

  test("print view renders the pack header and the same fee/net block as the web report", async ({ page }) => {
    await page.goto("/admin/books/reports/print")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("heading", { name: "Accountant Pack" })).toBeVisible()
    await expect(page.getByText(/total gross income/i).first()).toBeVisible()
    // Same contract as the web report: the fee line exists at zero payouts and
    // reads honestly rather than as a bare $0.00. (The per-branch behaviour is
    // pinned in __tests__/app/admin/books-reports-print-page.test.tsx.)
    await expect(page.getByText(/stripe processing fees/i).first()).toBeVisible()
    await page.screenshot({ path: "test-results/bookkeeping/04-reports-print.png", fullPage: true })
  })

  test("insights renders finders, dismiss controls and the narrative button (Track B)", async ({ page }) => {
    await page.goto("/admin/books/insights")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("button", { name: /explain these findings/i })).toBeVisible()
    await page.screenshot({ path: "test-results/bookkeeping/05-insights.png", fullPage: true })
  })

  test("email receipts shows an honest empty state (Track C)", async ({ page }) => {
    await page.goto("/admin/books/email-receipts")
    await page.waitForLoadState("networkidle")
    // Prod has zero polled receipts: the page must explain how to get some, not show a bare empty table.
    await expect(page.getByText(/gmail|label|no email receipts/i).first()).toBeVisible()
    await page.screenshot({ path: "test-results/bookkeeping/06-email-receipts.png", fullPage: true })
  })

  test("receipt dialogs open from the ledger (cash / photo / amazon)", async ({ page }) => {
    await page.goto("/admin/books")
    await page.waitForLoadState("networkidle")

    // No isVisible() guard: these three buttons are unconditional on the ledger
    // toolbar. Wrapping the clicks in "if it happens to be there" made this test
    // incapable of failing — a toolbar that stopped rendering would have passed.
    for (const [name, title, shot] of [
      [/^add cash receipt$/i, /^add cash receipt$/i, "07-receipt-cash"],
      [/^upload receipt$/i, /^upload receipt photos$/i, "08-receipt-photo"],
      [/^import amazon$/i, /^import amazon orders$/i, "09-receipt-amazon"],
    ] as const) {
      await page.getByRole("button", { name }).click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole("heading", { name: title })).toBeVisible()
      await page.screenshot({ path: `test-results/bookkeeping/${shot}.png`, fullPage: true })
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
    }
  })
})
