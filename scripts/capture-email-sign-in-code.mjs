// Annotated screenshots of "Email me a sign-in code" on the REAL /login and
// /register pages, against `next dev` on :3050 and the development clone.
//
// The code is real: the script asks for one, reads it back out of the
// subject line of the email Resend actually sent to the test inbox, types a
// wrong code first, then the right one, and lands signed in. The account is a
// dev-clone row (tayawaschoolworks+signincode@gmail.com) — /register is only
// submitted with that EXISTING email, which the route refuses (409) before
// any email, GoHighLevel or admin notification side effect.
//
//   node scripts/capture-email-sign-in-code.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only")

const BASE = "http://localhost:3050"
const EMAIL = "tayawaschoolworks+signincode@gmail.com"
const out = "screenshots/email-sign-in-code"
mkdirSync(`${out}/raw`, { recursive: true })
const checks = { pageErrors: [], screenshots: [], darkMode: "No dark-mode provider or switch on the auth pages" }
const SUBTITLE = "Real /login and /register pages · development clone · real code email to the test inbox"

async function resendEmails() {
  const res = await fetch("https://api.resend.com/emails?limit=20", {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "User-Agent": "capture-script" },
  })
  if (!res.ok) throw Error(`Resend list ${res.status}`)
  return (await res.json()).data ?? []
}

async function newCodeEmail(seenIds) {
  for (let i = 0; i < 30; i++) {
    const hit = (await resendEmails()).find(
      (e) => !seenIds.has(e.id) && e.to?.includes(EMAIL) && /^\d{6} is your/.test(e.subject),
    )
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw Error("No sign-in code email arrived")
}

async function prepare(page) {
  await page.waitForLoadState("networkidle")
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
  // Give React time to hydrate: an enabled button can still ignore a click before it.
  await page.waitForTimeout(1500)
}

async function shot(page, name, title, targets, { width, height, dsf, scale, subtitle = SUBTITLE }) {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  const markers = []
  // A marker sits beside its target, never on it: right by default, "left"
  // for a target with a neighbour on its right.
  for (const [locator, caption, side = "right"] of targets) {
    const box = await locator.boundingBox()
    if (!box || box.y < 0 || box.y + box.height > height) throw Error(`Missing or offscreen marker: ${caption}`)
    const gap = 30
    markers.push({
      x: (side === "left" ? Math.max(gap, box.x - gap) : Math.min(width - 22, box.x + box.width + gap)) * dsf,
      y: (box.y + box.height / 2) * dsf,
      caption,
    })
  }
  await page.screenshot({ path: `${out}/raw/${name}.png` })
  await annotate(`${out}/raw/${name}.png`, `${out}/${name}.png`, { title, subtitle, markers, scale })
  checks.screenshots.push(name)
}

const browser = await chromium.launch({ headless: true })
try {
  const desk = { width: 1440, height: 900, dsf: 2 }
  const context = await browser.newContext({
    viewport: { width: desk.width, height: desk.height },
    deviceScaleFactor: desk.dsf,
    reducedMotion: "reduce",
  })
  const page = await context.newPage()
  page.on("pageerror", (e) => checks.pageErrors.push(e.message))

  // 1. The login page now offers a code.
  await page.goto(`${BASE}/login`)
  await prepare(page)
  const codeButton = page.getByRole("button", { name: "Email me a sign-in code", exact: true })
  await shot(
    page,
    "01-login-page",
    "Login page: a second way in, no password needed",
    [
      [codeButton, "New: email me a 6-digit code instead of typing a password"],
      [page.getByRole("link", { name: "Forgot password?", exact: true }), "Resetting a password still works as before"],
    ],
    desk,
  )

  // 2. Ask for a code.
  await codeButton.click()
  await page.locator("#code-email").fill(EMAIL)
  await shot(
    page,
    "02-ask-for-a-code",
    "Step 1: type your email, tap “Send me a code”",
    [
      [page.getByRole("button", { name: "Send me a code", exact: true }), "Sends a 6-digit code to this email"],
      [page.getByRole("button", { name: "Use my password instead", exact: true }), "Back to the password form"],
    ],
    desk,
  )

  // 3. Code sent.
  const seen = new Set((await resendEmails()).map((e) => e.id))
  await page.getByRole("button", { name: "Send me a code", exact: true }).click()
  const codeInput = page.locator("#login-code")
  await codeInput.waitFor({ state: "visible" })
  const email = await newCodeEmail(seen)
  const code = email.subject.slice(0, 6)
  await shot(
    page,
    "03-enter-the-code",
    "Step 2: type the 6 digits from the email",
    [
      [
        page.getByRole("status").filter({ hasText: "6-digit code" }),
        "Same message whether or not the email has an account",
      ],
      [codeInput, "Numbers only. Phones offer the code from the email"],
      [
        page.getByRole("button", { name: /^Send a new code/ }),
        "Waits 60 s, so a double tap can't cancel the first code",
      ],
    ],
    desk,
  )

  // 4. A wrong code.
  await codeInput.fill(code === "000000" ? "111111" : "000000")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  const banner = page.getByText("That code didn't work", { exact: false })
  await banner.waitFor({ state: "visible" })
  await shot(
    page,
    "04-wrong-code",
    "A wrong code: say what to do next",
    [[banner, "Five wrong tries and that code stops working"]],
    desk,
  )

  // 5. The right code signs in.
  await codeInput.fill(code)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000, waitUntil: "commit" })
  await prepare(page)
  const session = await (await page.request.get(`${BASE}/api/auth/session`)).json()
  if (session?.user?.email !== EMAIL) throw Error(`Signed in as ${session?.user?.email ?? "nobody"}`)
  checks.landedOn = new URL(page.url()).pathname
  const heading = page.locator("h1").first()
  await shot(
    page,
    "05-signed-in",
    "Signed in with the code, no password typed",
    [[heading, `Landed on ${checks.landedOn} as Maya Torres`]],
    desk,
  )

  // 6. The email itself, as Resend stored it.
  const full = await (
    await fetch(`https://api.resend.com/emails/${email.id}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "User-Agent": "capture-script" },
    })
  ).json()
  const mail = await context.newPage()
  await mail.setViewportSize({ width: 720, height: 900 })
  await mail.setContent(full.html, { waitUntil: "networkidle" })
  await mail.screenshot({ path: `${out}/raw/06-the-email.png`, fullPage: true })
  await annotate(`${out}/raw/06-the-email.png`, `${out}/06-the-email.png`, {
    title: `The email: “${full.subject}”`,
    subtitle:
      "The HTML Resend actually sent, shown in a browser (not a mail app). The code is in the subject line too.",
    markers: [],
    scale: 2,
  })
  checks.screenshots.push("06-the-email")
  checks.email = { id: email.id, subject: full.subject, from: full.from, last_event: full.last_event }
  await mail.close()
  await context.close()

  // 7. /register with an email that already has an account.
  const fresh = await browser.newContext({
    viewport: { width: desk.width, height: desk.height },
    deviceScaleFactor: desk.dsf,
    reducedMotion: "reduce",
  })
  const reg = await fresh.newPage()
  reg.on("pageerror", (e) => checks.pageErrors.push(e.message))
  await reg.goto(`${BASE}/register`)
  await prepare(reg)
  await reg.locator("#firstName").fill("Maya")
  await reg.locator("#lastName").fill("Torres")
  await reg.locator("#dateOfBirth").fill("1998-05-14")
  await reg.locator("#email").fill(EMAIL)
  await reg.locator("#password").fill("training-every-day-2026")
  await reg.locator("#confirmPassword").fill("training-every-day-2026")
  await reg.locator("#termsAccepted").click()
  const registerCall = reg.waitForResponse((r) => r.url().endsWith("/api/auth/register"))
  await reg.getByRole("button", { name: "Create Account", exact: true }).click()
  const registerStatus = (await registerCall).status()
  if (registerStatus !== 409) throw Error(`/api/auth/register answered ${registerStatus}, expected 409`)
  const exists = reg.getByText("You already have an account with this email.", { exact: true })
  await exists.waitFor({ state: "visible" })
  await reg.evaluate(() => window.scrollTo(0, 0))
  const codeLink = reg.getByRole("link", { name: "Email me a sign-in code", exact: true })
  await shot(
    reg,
    "07-register-account-exists",
    "Sign-up with an email that already has an account",
    [
      [exists, "Was a dead end; now it points to the way in"],
      [codeLink, "Opens the code option with the email filled in", "left"],
    ],
    desk,
  )

  // 8. That link lands on the code option, email already typed.
  await codeLink.click()
  await reg.waitForURL((url) => url.pathname === "/login")
  await prepare(reg)
  const prefilled = reg.locator("#code-email")
  if ((await prefilled.inputValue()) !== EMAIL) throw Error("Email was not carried over")
  await shot(
    reg,
    "08-from-register-to-code",
    "From sign-up straight to “Send me a code”",
    [[prefilled, "Email carried over from the sign-up form"]],
    desk,
  )
  await fresh.close()

  // 9. On a phone.
  const phone = { width: 390, height: 844, dsf: 3, scale: 3 }
  const mobile = await browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    deviceScaleFactor: phone.dsf,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  })
  const m = await mobile.newPage()
  m.on("pageerror", (e) => checks.pageErrors.push(e.message))
  await m.goto(`${BASE}/login?mode=code&email=${encodeURIComponent(EMAIL)}`)
  await prepare(m)
  await m.getByRole("button", { name: "Send me a code", exact: true }).click()
  await m.locator("#login-code").waitFor({ state: "visible" })
  await m.locator("#login-code").fill("4829")
  await shot(
    m,
    "09-phone-enter-the-code",
    "On a phone",
    [[m.getByText("6-digit code", { exact: true }), "Opens the number keypad on a phone"]],
    { ...phone, subtitle: "Real /login at 390 px wide" },
  )
  await mobile.close()
} finally {
  await browser.close()
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2))
}
console.log(JSON.stringify(checks, null, 2))
