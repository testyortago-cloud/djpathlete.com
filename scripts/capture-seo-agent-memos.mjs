// Real-app capture: /admin/seo-agent/memos after the plain-language rewrite.
//
// DEV CLONE ONLY. Needs the two dev copies of the 2026-11-08 prod memos (seeded by SQL on 2026-11-09).
// Writes ONE thing: shot 3 clicks "Mark as handled", which marks the dev copy of the flag notification read.
// It NEVER clicks "Write the draft": that enqueues a Firestore ai_job, and ai_jobs run in the DEPLOYED
// function against PRODUCTION, so a dev click would write a real blog draft to prod.
//
// Run (dev server on 3050): node scripts/capture-seo-agent-memos.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import { encode } from "next-auth/jwt"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3050"
const OUT = "screenshots/seo-agent-memos"
const FLAG_ID = "dfe8e7b9-ad9f-43b5-8cfe-1879fbb6ba3a"
const W = 1440
const H = 1000
mkdirSync(`${OUT}/raw`, { recursive: true })

const check = (name, ok, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name}`)
}
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x), y: Math.round(y), caption }
}
const hideDevChrome = (page) =>
  page
    .addStyleTag({ content: "nextjs-portal{display:none!important}" })
    .catch((e) => console.warn(`WARN hideDevChrome failed, dev overlay may show: ${e.message.split("\n")[0]}`))
const frame = async (page, loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.evaluate(() => window.scrollBy(0, -96))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
}

// Reset the one row this script changes, so a rerun starts from "Waiting for you".
await db.from("notifications").update({ is_read: false }).eq("id", FLAG_ID)

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  const { data: admin } = await db
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", env.DEV_AUTH_BYPASS_EMAIL)
    .single()
  if (admin?.role !== "admin") throw Error(`DEV_AUTH_BYPASS_EMAIL is not an admin on the clone`)
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: {
      id: admin.id,
      sub: admin.id,
      email: admin.email,
      name: `${admin.first_name} ${admin.last_name}`,
      role: admin.role,
    },
    maxAge: 60 * 60,
  })
  await ctx.addCookies([{ name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" }])

  await page.goto(`${APP}/admin/seo-agent/memos`, { waitUntil: "load", timeout: 300000 })
  check("signed in, on the memos page", new URL(page.url()).pathname === "/admin/seo-agent/memos", page.url())
  await hideDevChrome(page)

  const flagMemo = page.locator("article", { hasText: "Has a question for you" })
  const postMemo = page.locator("article", { hasText: "Suggested a new blog post" })
  await flagMemo.waitFor({ timeout: 60000 })
  const sweep = flagMemo.locator("div.rounded-lg", { hasText: "Linked your posts together" })
  const flag = flagMemo.locator("div.rounded-lg", { hasText: "Has a question for you" })
  check(
    "sweep names both posts",
    await sweep.getByText(/Change of Direction Speed Assessment.*Hamstring Injuries/).isVisible(),
  )
  console.log(`INFO sweep card as shown: ${(await sweep.innerText()).split("\n").slice(0, 2).join(" | ")}`)
  check("flag offers Mark as handled", await flag.getByRole("button", { name: "Mark as handled" }).isVisible())
  check("no raw job id outside the technical details", !(await page.getByText("juT9g9RUPZYm4M3tIygn").isVisible()))

  // 1. The memo with the link sweep and the question, under the page title.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/01-question-memo.png` })
  await annotate(`${OUT}/raw/01-question-memo.png`, `${OUT}/01-question-memo.png`, {
    title: "A week's note, in plain words, with a button where you are needed",
    subtitle: "Admin > SEO Agent > Weekly Notes (dev copy of the 8 Nov 2026 run)",
    markers: [
      await marker(
        flagMemo.getByText(/^Agent is unsure/),
        "How sure the agent is. 4 or lower: read its reasons first.",
        "above",
      ),
      await marker(sweep.getByText(/Adds a link inside/), "Real post titles instead of ids.", "before"),
      await marker(sweep.getByRole("link", { name: /^Open/ }), "Opens the post it linked to.", "above"),
      await marker(flagMemo.getByText(/^Why it chose these/), "The agent's own reasoning, one click away.", "before"),
      await marker(
        flag.getByRole("button", { name: "Mark as handled" }),
        "Tell the agent you dealt with its question.",
        "before",
      ),
    ],
  })

  // 2. The memo that suggested a new post.
  const newPost = postMemo.locator("div.rounded-lg", { hasText: "Suggested a new blog post" })
  check("new post offers Write the draft", await newPost.getByRole("button", { name: "Write the draft" }).isVisible())
  await frame(page, postMemo)
  await page.screenshot({ path: `${OUT}/raw/02-new-post-memo.png` })
  await annotate(`${OUT}/raw/02-new-post-memo.png`, `${OUT}/02-new-post-memo.png`, {
    title: "A suggested post you can start with one click",
    subtitle:
      "Admin > SEO Agent > Weekly Notes (dev copy of the 8 Nov 2026 Sunday run). Button not pressed in this capture.",
    markers: [
      await marker(newPost.getByText("Waiting for you"), "Needs you: nothing happens until you start it.", "above"),
      await marker(
        newPost.getByRole("button", { name: "Write the draft" }),
        "Starts the AI draft, same as Topic Suggestions.",
        "before",
      ),
      await marker(
        postMemo.locator("summary", { hasText: "Technical details" }),
        "Ids and raw data, folded away for support.",
        "before",
      ),
    ],
  })

  // 3. After pressing "Mark as handled".
  await frame(page, flagMemo)
  await page.waitForTimeout(1500) // hydration: an early click does nothing
  await flag.getByRole("button", { name: "Mark as handled" }).click()
  await flag.getByText("Handled", { exact: true }).waitFor({ timeout: 30000 })
  check("button is gone once handled", (await flag.getByRole("button", { name: "Mark as handled" }).count()) === 0)
  const { data: row } = await db.from("notifications").select("is_read").eq("id", FLAG_ID).single()
  check("the bell notification is now read", row?.is_read === true)
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" })
  await frame(page, flagMemo)
  await page.screenshot({ path: `${OUT}/raw/03-question-handled.png` })
  await annotate(`${OUT}/raw/03-question-handled.png`, `${OUT}/03-question-handled.png`, {
    title: 'After "Mark as handled"',
    subtitle: "The question shows Handled and the button goes. The agent reads this in its next weekly run.",
    markers: [
      await marker(flag.getByText("Handled", { exact: true }), "Saved. The bell notification is cleared too.", "above"),
    ],
  })

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "))
} finally {
  await browser.close()
}
