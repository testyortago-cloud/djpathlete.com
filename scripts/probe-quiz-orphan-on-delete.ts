// Proves, against the RUNNING app and the dev clone, that deleting a funnel
// takes its quiz with it — and never takes one another funnel is still using.
//
//   npm run dev                                   # in another terminal (3050)
//   APP=http://localhost:3050 npx tsx scripts/probe-quiz-orphan-on-delete.ts .env.local
//
// NOT A SCREENSHOT RUN. What is being proved is the ABSENCE of a row after an
// action, which no picture can show. Every check reads the database back.
//
// WHY THE SHARED CASE IS THE ONE THAT MATTERS. Deleting a quiz cascades
// `quiz_attempts` — every answer, score and tier recorded against it, and the
// last copy, because `funnel_submissions` cascades away with the funnel itself.
// So deleting a quiz that a SECOND funnel still runs would destroy a live
// feature and its history at once. That is the case this probe exists for.
//
// THE WHOLE SHAPE IS BUILT THROUGH REAL ROUTES: the New funnel dialog creates
// each quiz funnel, `POST /api/admin/quizzes/<id>/add-to-step` shares one quiz
// onto a second funnel's page, and the board's own bin button does the delete.
// Everything it creates is removed again in `finally`.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser } from "playwright"

const APP = process.env.APP ?? "http://localhost:3050"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const STAMP = process.env.STAMP ?? String(Date.now()).slice(-6)
const FUNNEL_A = `Orphan Probe A ${STAMP}`
const FUNNEL_B = `Orphan Probe B ${STAMP}`

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`  ok — ${message}`)
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch {
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
    throw new Error("No usable Chromium.")
  }
}

async function signInAsAdmin(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded" })
  if (!page.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${page.url()})`)
  await page.close()
  console.log("  signed in as admin, session asserted")
}

/** Creates a quiz funnel through the real dialog. Returns its quiz id. */
async function createQuizFunnel(page: Page, name: string): Promise<string> {
  await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)
  await page.getByRole("button", { name: "New funnel" }).first().click()
  await page.getByRole("radio", { name: /run a quiz/i }).click()
  await page.getByLabel(/^name/i).fill(name)
  await page.getByLabel(/copy questions from/i).waitFor()
  await page.waitForTimeout(400)
  await page.getByRole("button", { name: /create funnel/i }).click()
  await page.waitForURL(/\/admin\/funnels\/quizzes\//, { timeout: 60_000 })
  return page.url().split("/quizzes/")[1].split(/[?#]/)[0]
}

/** Deletes a funnel with the board's own bin button, accepting the confirm. */
async function deleteFromBoard(page: Page, name: string): Promise<string> {
  await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
  let asked = ""
  page.once("dialog", async (dialog) => {
    asked = dialog.message()
    await dialog.accept()
  })
  const card = page.locator('[data-testid="funnel-card"]').filter({ hasText: name }).first()
  if ((await card.count()) === 0) throw new Error(`no card for "${name}" to delete`)
  await card.getByLabel(`Delete ${name}`).click()
  await page.waitForTimeout(3000)
  return asked
}

async function main(): Promise<void> {
  const env = loadEnv(process.argv[2] ?? ".env.local")
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  must(url.includes(CLONE_REF), `refusing to run against anything but the dev clone`)
  const supabase: SupabaseClient = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  })
  const quizExists = async (id: string) =>
    Boolean((await supabase.from("quizzes").select("id").eq("id", id).maybeSingle()).data)
  const funnelIdOf = async (name: string) =>
    String((await supabase.from("funnels").select("id").eq("name", name).maybeSingle()).data?.id ?? "")

  const browser = await launchChromium()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  let quizA = "", quizB = "", idA = "", idB = ""

  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    quizA = await createQuizFunnel(page, FUNNEL_A)
    idA = await funnelIdOf(FUNNEL_A)
    quizB = await createQuizFunnel(page, FUNNEL_B)
    idB = await funnelIdOf(FUNNEL_B)
    console.log(`  funnel A ${idA} runs quiz ${quizA}; funnel B ${idB} runs quiz ${quizB}`)

    // ---- Share quiz A onto funnel B's page, through the real route. --------
    const { data: bStep } = await supabase
      .from("funnel_steps")
      .select("id")
      .eq("funnel_id", idB)
      .eq("is_entry", true)
      .maybeSingle()
    const shareRes = await page.evaluate(
      async ([quizId, stepId]) => {
        const res = await fetch(`/api/admin/quizzes/${quizId}/add-to-step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId }),
        })
        return res.status
      },
      [quizA, String((bStep as { id: string }).id)],
    )
    must(shareRes === 200, `quiz A is now ALSO on funnel B's page (add-to-step -> ${shareRes})`)

    // ---- Delete A. Its quiz is shared, so it must SURVIVE. -----------------
    const askedA = await deleteFromBoard(page, FUNNEL_A)
    must(askedA.includes("quiz"), `the confirmation warned about the quiz: ${JSON.stringify(askedA.slice(0, 160))}`)
    must(!(await funnelIdOf(FUNNEL_A)), "funnel A is gone")
    must(await quizExists(quizA), "quiz A SURVIVED, because funnel B still runs it")

    // ---- Delete B. Now nothing points at either quiz. ----------------------
    await deleteFromBoard(page, FUNNEL_B)
    must(!(await funnelIdOf(FUNNEL_B)), "funnel B is gone")
    must(!(await quizExists(quizA)), "quiz A is now deleted — its last funnel went")
    must(!(await quizExists(quizB)), "quiz B is deleted too")

    console.log("\nAll checks passed.")
  } finally {
    for (const id of [idA, idB]) if (id) await supabase.from("funnels").delete().eq("id", id)
    for (const id of [quizA, quizB]) if (id) await supabase.from("quizzes").delete().eq("id", id)
    console.log("  cleaned up")
    await ctx.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
})
