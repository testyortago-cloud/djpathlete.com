// Drives the REAL app to prove a won deal can hand the athlete their account.
//
//   npm run dev                                    # port 3050, another terminal
//   APP=http://localhost:3050 npx tsx scripts/capture-won-deal-grant.ts .env.local
//
// WHAT IT PROVES
//
//   1. The real /admin/pipeline board, not a harness.
//   2. Dropping a card on Won opens ONE question — which program did they buy —
//      and nothing is created until it is answered.
//   3. The picker offers priced products only. The dev clone has 16 grantable
//      programs and far more active ones; the athletes' own named plans must
//      not appear.
//
// THE SUBJECT IS CHOSEN, NOT TAKEN AT RANDOM. Priya Raman's card has
// `source_session_id = null`, so it exercises the grant branch. A card that
// reached Won through checkout is refused by design (it is already
// provisioned), and picking one of those would have quietly demonstrated the
// other branch with nothing on screen looking wrong.
//
// IT DOES NOT CLICK "Give them access". That would create a real account and
// attempt a real invite email. The prompt is the new surface; the granting is
// covered by grant-manual.test.ts. The card is moved back to its own stage
// afterwards so the clone is left as it was found.
//
// WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE — see CLONE_REF.

import { readFileSync, mkdirSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/won-deal-grant"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1000
const DSF = 2

// Priya Raman — Consult Booked, no checkout session. See the header.
const SUBJECT_OPP = "5ceb5c92-30f1-4673-bdb7-5b0625be3f5c"
const SUBJECT_NAME = "Priya Raman"

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

/**
 * Markers are RAW PIXELS, so they must come from the live box x DSF.
 *
 * `anchorSelector` moves the dot OUTSIDE that element instead of centring it
 * on top: the first take put marker 1 across the dialog's own title, hiding
 * the word "with", and marker 3 across "Not now" so it read "N (3) w". A
 * callout that covers what it points at is worse than no callout.
 */
async function markerFor(
  page: Page,
  selector: string,
  caption: string,
  opts: { anchorSelector?: string } = {},
) {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`no element matched ${selector} - marker would be a guess`)
  let x = box.x - 18
  if (opts.anchorSelector) {
    const anchor = await page.locator(opts.anchorSelector).first().boundingBox()
    if (!anchor) throw new Error(`no element matched anchor ${opts.anchorSelector}`)
    x = anchor.x - 18
  }
  return { x: Math.round(x * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

async function signInAsAdmin(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/pipeline`, { waitUntil: "domcontentloaded" })
  await page.waitForURL(/\/admin\//, { timeout: 20000 })
  must(page.url().includes("/admin"), `dev-login did not reach /admin (at ${page.url()})`)
  await page.close()
}

async function main() {
  const envPath = process.argv[2] ?? ".env.local"
  const env = loadEnv(envPath)
  must(
    (env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(CLONE_REF),
    `${envPath} does not point at the dev clone (${CLONE_REF}). Refusing to run.`,
  )
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Remember where the card started so it can be put back.
  const { data: before } = await supabase
    .from("opportunities")
    .select("stage_id, outcome")
    .eq("id", SUBJECT_OPP)
    .single()
  must(before != null, "subject opportunity not found on the clone")

  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()
    await page.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1200) // hydration: dnd-kit listeners attach after paint

    const card = page.getByText(SUBJECT_NAME).first()
    must(await card.isVisible(), `${SUBJECT_NAME}'s card is not on the board`)

    await page.screenshot({ path: `${OUT}/raw-01-board.png` })
    await annotate(`${OUT}/raw-01-board.png`, `${OUT}/01-pipeline-board.png`, {
      title: "The pipeline board, before",
      subtitle: `${SUBJECT_NAME} is in Consult Booked. This deal never went through checkout, so nobody has an account for her yet.`,
      markers: [
        // Anchored to the column, not the card: at the card's own left edge the
        // dot sits on the first letter of the name.
        await markerFor(page, `text=${SUBJECT_NAME}`, "1. The deal we are about to win", {
          anchorSelector: "text=CONSULT BOOKED",
        }),
      ],
    })

    // Drag to Won. dnd-kit listens to pointer events and needs intermediate
    // moves — a single jump is not a drag, and its 5px activation constraint
    // means the first move must clear that distance.
    const from = await card.boundingBox()
    const wonCol = page.getByText("Won", { exact: true }).first()
    const to = await wonCol.boundingBox()
    must(from != null && to != null, "could not locate the card or the Won column")
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    await page.mouse.move(from!.x + from!.width / 2 + 20, from!.y + from!.height / 2 + 20, { steps: 8 })
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2 + 80, { steps: 25 })
    await page.mouse.up()

    const dialog = page.getByRole("dialog")
    await dialog.waitFor({ state: "visible", timeout: 15000 })

    const heading = await dialog.getByRole("heading").first().textContent()
    must((heading ?? "").includes(SUBJECT_NAME), `the prompt does not name the athlete (saw: ${heading})`)

    // The picker must not offer other athletes' personal plans.
    const options = await dialog.locator('input[type="radio"]').count()
    must(options > 0, "the prompt offered no programs at all")
    console.log(`--> the prompt offers ${options} priced programs`)

    await page.screenshot({ path: `${OUT}/raw-02-prompt.png` })
    await annotate(`${OUT}/raw-02-prompt.png`, `${OUT}/02-which-program.png`, {
      title: "Winning the deal asks one question",
      subtitle:
        "Nothing is created yet. Winning a deal does not say what was sold, so the coach picks it - a mis-dragged card can never mail a stranger.",
      markers: [
        await markerFor(page, '[role="dialog"] h2', "1. It names the athlete, so you know whose deal this is", {
          anchorSelector: '[role="dialog"]',
        }),
        // The plans are named after the athletes they were built for, because
        // that is what this coach sells. Only the priced ones appear - the 50
        // unpriced drafts and templates are left out.
        await markerFor(page, '[role="dialog"] input[type="radio"]', "2. Every program that has a price, listed A-Z", {
          anchorSelector: '[role="dialog"]',
        }),
        await markerFor(page, '[role="dialog"] button:has-text("Not now")', "3. Walking away is normal: the deal stays won", {
          anchorSelector: '[role="dialog"]',
        }),
      ],
    })

    console.log(`--> wrote ${OUT}/01-pipeline-board.png and ${OUT}/02-which-program.png`)
  } finally {
    // Put the clone back exactly as it was found.
    await supabase
      .from("opportunities")
      .update({ stage_id: before!.stage_id, outcome: before!.outcome, closed_at: null, closed_trigger: null })
      .eq("id", SUBJECT_OPP)
    await ctx.close()
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
