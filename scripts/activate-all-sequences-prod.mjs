// Switches ON every currently-off sequence on PRODUCTION, through the real
// on/off switch on the real /admin/sequences screen — the control gap #11
// shipped — rather than by writing to the database behind it.
//
//   node --env-file=.env.prod scripts/activate-all-sequences-prod.mjs
//
// RUN ON THE OWNER'S EXPLICIT INSTRUCTION ("turn all of it on", 2026-09-09).
// This sends real email and texts to real members of the public from the
// moment their trigger fires. It is not a dry run and there is no undo beyond
// switching each one back off.
//
// ONLY EVER TURNS ON, NEVER OFF. It selects switches by their `Turn on "…"`
// aria-label, which SequenceSwitch renders only while a sequence is off, so a
// sequence that is already on is not a candidate and cannot be touched. That
// matters because turning one OFF takes effect immediately with no dialog —
// see SequenceSwitch.requestToggle — so a stray click on an already-on row
// would be a live, unconfirmable change.
//
// Turning ON always opens an AlertDialog first; this script answers it with
// "Switch on" deliberately, which is the whole point of the run.
//
// PRODUCTION ONLY; refuses any other Supabase project ref outright.

import { chromium } from "playwright"
import { encode } from "next-auth/jwt"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const PROD_REF = "epzuvzkokzqtzomeyoha"
const APP = process.env.APP ?? "https://www.darrenjpaul.com"
const ADMIN_ID = "00000000-0000-0000-0000-000000000001"
const ADMIN_EMAIL = "admin@darrenjpaul.com"

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== PROD_REF) throw new Error(`PRODUCTION ONLY; refusing — env points at ${ref}`)

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function main() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET missing from .env.prod")

  const token = await encode({
    secret,
    salt: "__Secure-authjs.session-token",
    token: { id: ADMIN_ID, sub: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", name: "Darren Paul" },
  })

  const browser = await launchChromium()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  })
  await ctx.addCookies([
    {
      name: "__Secure-authjs.session-token",
      value: token,
      domain: ".darrenjpaul.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ])

  const page = await ctx.newPage()

  // Session first — an expired token redirects to /login and everything below
  // would then silently "find no switches to turn on" and report success.
  await page.goto(`${APP}/api/auth/session`, { waitUntil: "domcontentloaded" })
  const session = JSON.parse(await page.locator("body").innerText())
  if (session?.user?.role !== "admin") throw new Error("SESSION NOT ADMIN — refusing")
  console.log(`  session OK: ${session.user.email}`)

  await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)

  const before = await page
    .locator('[role="switch"]')
    .evaluateAll((els) => els.map((e) => ({ label: e.getAttribute("aria-label"), checked: e.getAttribute("aria-checked") })))
  const targets = before.filter((s) => s.checked !== "true").map((s) => s.label)
  console.log(`  ${before.length} sequences, ${targets.length} currently off\n`)

  const done = []
  const failed = []

  for (const label of targets) {
    const name = label.replace(/^Turn on "/, "").replace(/"$/, "")
    const sw = page.locator(`[role="switch"][aria-label=${JSON.stringify(label)}]`)
    if ((await sw.count()) !== 1) {
      console.warn(`  !! ${name}: expected 1 switch, found ${await sw.count()} — skipping`)
      failed.push(name)
      continue
    }
    await sw.click()

    // Turning ON always confirms. If the dialog does not appear, something has
    // changed about the control and we stop rather than guess.
    const confirm = page.getByRole("button", { name: "Switch on", exact: true })
    try {
      await confirm.waitFor({ state: "visible", timeout: 8000 })
    } catch {
      console.warn(`  !! ${name}: confirm dialog never appeared — STOPPING`)
      failed.push(name)
      break
    }
    await confirm.click()

    // The switch flips only after the PATCH succeeds and router.refresh()
    // re-renders with the new status prop. Wait for the label to invert.
    const onLabel = `Turn off "${name}"`
    try {
      await page.locator(`[role="switch"][aria-label=${JSON.stringify(onLabel)}]`).waitFor({ state: "visible", timeout: 15000 })
      console.log(`  ON   ${name}`)
      done.push(name)
    } catch {
      console.warn(`  !! ${name}: never flipped to on — the save may have failed`)
      failed.push(name)
    }
    await page.waitForTimeout(600)
  }

  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
  const after = await page
    .locator('[role="switch"]')
    .evaluateAll((els) => els.map((e) => ({ label: e.getAttribute("aria-label"), checked: e.getAttribute("aria-checked") })))
  const stillOff = after.filter((s) => s.checked !== "true")

  console.log(`\n  switched on this run: ${done.length}`)
  if (failed.length) console.log(`  FAILED: ${failed.join(", ")}`)
  console.log(`  still off after reload: ${stillOff.length}`)
  for (const s of stillOff) console.log(`    ${s.label}`)

  await browser.close()
}

main().catch((e) => {
  console.error("\nFAILED:", e.message)
  process.exit(1)
})
