// Drives the REAL page builder on the REAL route with the REAL model, pasting a
// REAL image into the REAL chat composer.
//
//   node scripts/make-reference-brand-board.mjs      # the reference to paste
//   npx next dev --port 3061                         # NOT 3050 — another session owns it
//   node scripts/capture-builder-reference-image.mjs
//
// This spends real model calls. It is the only way to photograph this feature:
// the claim is "a pasted image visibly changes the page the AI builds, and the
// direction survives later turns", and no fixture can show a model looking at
// a picture.
//
// WHAT IT REFUSES TO DO. It will not caption a pass it did not get. If the
// document's theme does not actually move toward the reference, or the model
// does not write a `designNote`, or the note does not survive the follow-up
// turn, it throws instead of shooting. A screenshot script that photographs
// whatever happened is a screenshot script that will eventually photograph a
// regression and call it a feature.
//
// LIGHT ONLY (the admin was never built against `.dark`). DEV CLONE ONLY.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"
import { launchChromium } from "./_launch-chromium.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3061"
const OUT = "screenshots/builder-reference-image"
const REFERENCE = `${OUT}/reference-brand-board.png`
const WIDTH = 1600
const HEIGHT = 950
const DSF = 2
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const FUNNEL = "a7450381-3042-4f0b-9236-abf3bf8e10ad"
const STEP = "7f5da342-aa37-42aa-bed3-020842893da9"

const ASK = "Here's our brand board. Rebuild this page to match it."
const FOLLOW_UP = "Make the headline bolder."
// The last revision whose stored document predates any reference image. Set to
// null to skip the reset and capture from wherever the page already is.
const RESET_TO = 34

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const rest = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
}

// ---------------------------------------------------------------------------
// Reading the DOCUMENT, which is the only honest progress signal
// ---------------------------------------------------------------------------

async function readDoc() {
  const rows = await (
    await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnel_steps?select=project_data,doc_revision,slug,updated_at&id=eq.${STEP}`,
      { headers: rest },
    )
  ).json()
  return rows[0]
}

function themeOf(row) {
  return row?.project_data?.theme ?? {}
}

/**
 * Wait until the stored DOCUMENT stops changing, not until it first changes.
 *
 * TWO TRAPS, BOTH PAID FOR HERE, both already known and both landed on anyway:
 *
 * 1. KEY ON `project_data`, NOT ON `doc_revision`. The route records the
 *    owner's message BEFORE spending anything, and that user turn moves the
 *    revision WITHOUT touching the draft. A first version of this function
 *    treated that bump as "the document moved", counted twenty quiet seconds
 *    while the model was still thinking, declared the turn finished, and killed
 *    the browser mid-request. The turn log showed a user turn at revision 35
 *    and no assistant turn at all.
 *
 * 2. A FIRST DRAFT IS NOT ONE WRITE. The route applies a `result` the moment
 *    the page is written, then holds the stream open another 30-40s for a
 *    review pass that can write a SECOND, revised document. Returning on the
 *    first changed read photographs the pre-review draft.
 *
 * So: wait for `project_data` itself to differ from where it started, THEN for
 * N consecutive identical reads. The window is still a heuristic, not a
 * guarantee — the caller diffs the revision against the database after the
 * last shot rather than trusting that it was long enough.
 */
async function waitForStableDoc(baselineProjectData, { quietReads = 5, everyMs = 4000, timeoutMs = 420_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  const baseline = JSON.stringify(baselineProjectData)
  let last = null
  let quiet = 0
  let moved = false
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, everyMs))
    const row = await readDoc()
    const snap = JSON.stringify(row.project_data)
    if (snap !== baseline) moved = true
    if (moved && snap === last) {
      quiet += 1
      if (quiet >= quietReads) return row
    } else {
      if (moved && quiet === 0) console.log(`    …document written (rev ${row.doc_revision}), watching for a revision pass`)
      quiet = 0
    }
    last = snap
  }
  throw new Error(`document never settled within ${timeoutMs}ms`)
}

// ---------------------------------------------------------------------------
// Markers, derived from the real box so they land on the real thing
// ---------------------------------------------------------------------------

async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
  // Playwright's mouse stays where it last clicked; park it off the content.
  await page.mouse.move(4, 4)
  await page.waitForTimeout(300)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  return raw
}

// ---------------------------------------------------------------------------

const browser = await launchChromium(chromium)
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
mkdirSync(OUT, { recursive: true })
const log = []

try {
  const before = await readDoc()
  const themeBefore = themeOf(before)
  console.log(`  theme BEFORE: ${JSON.stringify(themeBefore)}`)
  console.log(`  revision BEFORE: ${before.doc_revision}`)

  // Sign in off-camera, in the SAME context.
  const p0 = await ctx.newPage()
  await p0.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await p0.waitForTimeout(2500)
  if (!p0.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p0.url()})`)
  await p0.close()
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()
  await page.goto(`${APP}/admin/funnels/${FUNNEL}/edit/${STEP}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(4000)

  // -------------------------------------------------------------------------
  // 0. Put the page back to a PRE-REFERENCE state, so "before" is honest.
  //
  // Through the route's own `{action:"reset"}`, not a raw column write: that is
  // the same code path the transcript's "Go back to here" button uses, so the
  // baseline is a state the product can actually be in, and it appends a turn
  // rather than rewriting history.
  //
  // Needed because an earlier aborted run of this script left the document
  // already branded. Photographing an "after" against an "after" would have
  // shown two clay pages and proved nothing.
  // -------------------------------------------------------------------------
  if (RESET_TO !== null) {
    const reset = await page.evaluate(
      async ([url, toRevision]) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset", toRevision }),
        })
        return { status: res.status, body: await res.text() }
      },
      [`/api/admin/funnels/steps/${STEP}/build`, RESET_TO],
    )
    if (reset.status !== 200) throw new Error(`reset to revision ${RESET_TO} failed: ${reset.status} ${reset.body.slice(0, 300)}`)
    console.log(`  reset the page back to revision ${RESET_TO} (pre-reference baseline)`)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForTimeout(4500)
  }

  const baseline = await readDoc()
  const baselineTheme = themeOf(baseline)
  console.log(`  baseline theme: ${JSON.stringify(baselineTheme)}`)
  log.push(`baseline theme (pre-reference): ${JSON.stringify(baselineTheme)}`)
  if (baselineTheme.designNote) {
    throw new Error(`the baseline still carries a designNote — the reset did not reach a pre-reference state`)
  }

  const box = page.getByPlaceholder(/Make the headline shorter/i)
  await box.waitFor({ state: "visible", timeout: 30000 })

  const raw0 = await shoot(page, "00")
  const r0 = await annotate(raw0, `${OUT}/00-before-the-reference.png`, {
    title: "Before: the page on the builder's own defaults",
    subtitle:
      `The same page, same route, deliberately restored to step ${RESET_TO} — the last version written before any reference image — so the comparison that follows is a fair one.`,
    markers: [
      await markerOn(page, page.locator('iframe[src*="funnel-preview"]:visible').first(), "Green Azure and Gray Orange, Lexend throughout, normal spacing — today's defaults.", { place: "center", dy: -280 }),
      await markerOn(page, box, "Nothing attached. The composer takes text only until you paste something into it.", { place: "left", dy: 10 }),
    ],
  })
  console.log(`  00 ${r0.width}x${r0.height}`)

  // -------------------------------------------------------------------------
  // 1. Paste the reference image — a REAL DOM paste event carrying a real File.
  //
  // Not `setInputFiles` on the hidden picker: paste is the path the owner asked
  // for and the one with the new handler on it, so it is the one that has to be
  // shown working. No named function inside the evaluate callback — a bundler
  // rewrites those to `__name(...)`, which does not exist in the browser.
  // -------------------------------------------------------------------------
  const b64 = readFileSync(REFERENCE).toString("base64")
  await box.click()
  await page.evaluate(
    async ([data, selector]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const file = new File([bytes], "meridian-brand-board.png", { type: "image/png" })
      const dt = new DataTransfer()
      dt.items.add(file)
      const target = document.querySelector(selector)
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [b64, "#builder-composer"],
  )

  // The chip only appears once the browser-side downscale resolves.
  await page.getByText(/meridian-brand-board\.png/i).waitFor({ state: "visible", timeout: 20000 })
  const chipLabel = await page.getByText(/meridian-brand-board\.png/i).first().innerText()
  console.log(`  staged chip: ${chipLabel.replace(/\n/g, " ")}`)
  log.push(`chip after downscale: ${chipLabel.replace(/\n/g, " ")}`)

  await box.fill(ASK)
  await page.waitForTimeout(400)

  const raw1 = await shoot(page, "01")
  const r1 = await annotate(raw1, `${OUT}/01-reference-image-staged-in-chat.png`, {
    title: "A reference design, pasted straight into the builder chat",
    subtitle:
      "The real composer on /admin/funnels/[id]/edit/[stepId]. Ctrl+V of a brand board — no upload dialog, no URL, nothing stored.",
    markers: [
      await markerOn(page, page.getByText(/meridian-brand-board\.png/i).first(), `The pasted image, shown by name and by its size AFTER the browser shrank it. ${chipLabel.replace(/\n/g, " ")} — the original is 2800px wide; it is resized to 1568px in the browser, because that is what the model downscales to anyway.`, { place: "after" }),
      await markerOn(page, page.getByRole("button", { name: /remove reference image/i }).first(), "It can be taken back off the turn before anything is spent.", { place: "after", dx: 34, dy: -40 }),
      await markerOn(page, box, `What was typed alongside it: “${ASK}”`, { place: "left", dy: 10 }),
    ],
  })
  console.log(`  01 ${r1.width}x${r1.height}`)

  // -------------------------------------------------------------------------
  // 2. Send, and wait on the DOCUMENT.
  // -------------------------------------------------------------------------
  await page.getByRole("button", { name: "Send", exact: true }).click()
  console.log(`  sent — waiting for the document to settle (this is a real model call)…`)
  const after = await waitForStableDoc(baseline.project_data)
  const themeAfter = themeOf(after)
  console.log(`  theme AFTER:  ${JSON.stringify(themeAfter)}`)
  console.log(`  revision AFTER: ${after.doc_revision}`)
  log.push(`theme before: ${JSON.stringify(baselineTheme)}`)
  log.push(`theme after:  ${JSON.stringify(themeAfter)}`)

  // REFUSE TO CAPTION A PASS WE DID NOT GET.
  if (!themeAfter.designNote) {
    throw new Error(`the model wrote no theme.designNote — refusing to caption a pass. theme=${JSON.stringify(themeAfter)}`)
  }
  if (JSON.stringify(themeAfter) === JSON.stringify(baselineTheme)) {
    throw new Error(`the theme did not change at all — refusing to caption a pass`)
  }
  console.log(`  designNote: ${JSON.stringify(themeAfter.designNote)}`)
  log.push(`designNote: ${themeAfter.designNote}`)

  await page.waitForTimeout(3000)
  // The transcript auto-scrolls to the bottom, which puts the owner's own turn
  // — the one carrying "Reference image attached" — above the fold. A marker
  // pointing at something off-screen is worse than no marker: it lands on
  // whatever happens to be at the fallback coordinate and captions it.
  // `scrollIntoViewIfNeeded` scrolls the minimum, so the reply below it stays
  // in frame.
  await page.getByText(/Reference image attached/i).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const raw2 = await shoot(page, "02")
  const replyText = await page.locator("p.whitespace-pre-wrap").last().innerText()
  log.push(`model reply: ${replyText}`)
  const r2 = await annotate(raw2, `${OUT}/02-the-model-says-what-it-could-not-match.png`, {
    title: "The model reads the image — and says what it could NOT match",
    subtitle:
      "Honesty was chosen over silently approximating. An owner who is told what is impossible can decide what to do; one who is not concludes the tool is bad at its job.",
    markers: [
      await markerOn(page, page.getByText(/Reference image attached/i).first(), "The transcript records that a reference rode with this turn — otherwise it would be a false record of what produced the page.", { place: "after" }),
      await markerOn(page, page.locator("p.whitespace-pre-wrap").last(), "The reply opens by naming what it DID take: the two hexes as a custom palette, serif headings, airy density, a wide measure, an alternating rhythm — each one traceable to something on the board.", { place: "after", dy: 40 }),
    ],
  })
  console.log(`  02 ${r2.width}x${r2.height}`)

  // 02b — THE OTHER END OF THE SAME REPLY.
  //
  // Two shots rather than one because the reply is longer than the pane: the
  // owner's attachment record and the "what I couldn't match" sentence cannot
  // both be on screen at once. A single frame with a marker pointing at the
  // second one while it sat below the fold is exactly the false caption this
  // script exists to avoid — and it happened once before this split.
  //
  // `.last()`, not `.first()`: earlier turns in this transcript contain the
  // same phrase, and `.first()` silently pinned one of those instead.
  const couldNotMatch = page.getByText(/couldn.t match|could not match|not expressible|no equivalent/i).last()
  if ((await couldNotMatch.count()) === 0) {
    // LOUD, not a silent skip. The model saying what it could not do is the
    // product decision this whole shot exists to evidence; a run where it did
    // not say it is a finding about the prompt, not a shot to quietly omit.
    throw new Error(
      `the reply never says what it could not match — that is the honesty rule in BLOCK_DESIGN failing, not a capture problem. Reply was:\n${replyText}`,
    )
  }
  await couldNotMatch.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const raw2b = await shoot(page, "02b")
  const r2b = await annotate(raw2b, `${OUT}/02b-what-it-could-not-match.png`, {
    title: "…and the same reply, at the other end",
    subtitle:
      "The reply is longer than the pane, so this is it scrolled down. The owner explicitly chose being told over being quietly approximated at.",
    markers: [
      await markerOn(page, couldNotMatch, "What it could NOT match, named: the board's exact fonts (Playfair Display, Inter Light) and its numbered swatch-and-rule layout. Neither is expressible in the typed design vocabulary, so it says which and why instead of guessing and hoping nobody checks.", { place: "after", dy: 20 }),
    ],
  })
  console.log(`  02b ${r2b.width}x${r2b.height}`)

  // -------------------------------------------------------------------------
  // 3. The Page design panel, carrying the note the model wrote.
  // -------------------------------------------------------------------------
  await page.getByRole("button", { name: "Page design", exact: true }).click()
  await page.waitForTimeout(1200)
  const raw3 = await shoot(page, "03")
  const r3 = await annotate(raw3, `${OUT}/03-the-durable-design-note.png`, {
    title: "What it took from the image is written into the page itself",
    subtitle:
      "theme.designNote — readable and editable by the owner. The image is never stored; this note is the only memory of it.",
    markers: [
      await markerOn(page, page.getByLabel(/design direction/i).first(), `The note the model wrote: “${themeAfter.designNote}”`, { place: "left", dy: 6 }),
      // The CUSTOM COLOURS row, not the preset grid above it. Pointing at the
      // twelve named presets while the caption quotes two hex values the model
      // typed in would be captioning the wrong control.
      await markerOn(page, page.getByText(/Custom colours/i).first(), `Not one of the twelve presets — the model typed the board's own hexes in: brand ${themeAfter.palette?.brand ?? "unset"}, accent ${themeAfter.palette?.accent ?? "unset"}. The rest of the palette (paper, ink, surfaces) is derived from those two and checked for contrast.`, { place: "left", dy: 26 }),
    ],
  })
  console.log(`  03 ${r3.width}x${r3.height}`)

  // -------------------------------------------------------------------------
  // 4. The page itself, on its real preview route.
  // -------------------------------------------------------------------------
  // THE SLUG IS READ, NEVER GUESSED, and never carried over from another
  // capture script. A hardcoded `/preview/camp-kfcsg` here — left over from the
  // script this one was patterned on — LOADED FINE, because that is a real
  // funnel on this clone, just not the one under test. So the fallback never
  // fired and the shot was of an unrelated red-and-green page underneath a
  // caption claiming warm paper and deep clay. A wrong URL that 404s announces
  // itself; a wrong URL that resolves does not.
  const funnelRows = await (
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnels?select=slug,name&id=eq.${FUNNEL}`, { headers: rest })
  ).json()
  const funnelSlug = funnelRows[0]?.slug
  if (!funnelSlug) throw new Error(`could not read the slug for funnel ${FUNNEL}`)
  const previewUrl = `${APP}/preview/${funnelSlug}/${baseline.slug}`
  console.log(`  preview: ${previewUrl}  (funnel "${funnelRows[0].name}")`)
  log.push(`preview url: ${previewUrl}`)

  const preview = await ctx.newPage()
  await preview.goto(previewUrl, { waitUntil: "domcontentloaded" })
  await preview.waitForTimeout(4500)
  // And the page that came back is the page under test, not something that
  // merely rendered: the headline the model just wrote has to be on it.
  const heroHeadline = after.project_data?.sections?.find((s) => s.kind === "hero")?.props?.headline
  if (heroHeadline) {
    // WORD BY WORD, NOT AS ONE FRAGMENT.
    //
    // The first version of this check filtered short words OUT of the headline
    // and then looked for the survivors as one contiguous string in the page
    // text — which still has the short words in it. "Built to last" became
    // "Built last", which can never appear, so the check failed on the RIGHT
    // page and called it the wrong one. The claim is "these words are on this
    // page", so test exactly that.
    //
    // Word-level also sidesteps the apostrophe trap: `escapeHtml` encodes `'`,
    // so an `includes` of raw authored copy false-negatives the moment the
    // headline has one in it. Punctuation is stripped from both sides here.
    const norm = (s) => s.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").toLowerCase()
    const shown = norm(await preview.locator("body").innerText())
    const words = [...new Set(norm(heroHeadline).split(" ").filter((w) => w.length > 3))].slice(0, 4)
    const missing = words.filter((w) => !shown.includes(w))
    if (words.length > 0 && missing.length > 0) {
      throw new Error(
        `${previewUrl} does not show this page's headline — missing ${JSON.stringify(missing)} from "${heroHeadline}". Wrong page; refusing to caption it.`,
      )
    }
    console.log(`  preview confirmed: headline words ${JSON.stringify(words)} are on the page`)
  }
  const raw4 = await shoot(preview, "04")
  const r4 = await annotate(raw4, `${OUT}/04-the-page-the-reference-produced.png`, {
    title: "The page the reference produced, on its own real route",
    subtitle: `/preview/<slug>/<step> — the same renderer publish uses. Open reference-brand-board.png beside this and compare the colour, the type and the spacing.`,
    markers: [
      // CAPTIONS DERIVED FROM THE STORED DOCUMENT, never hand-typed. A
      // hand-written "full-bleed measure" here outlived the run that justified
      // it — the next run chose width "wide" and the caption kept claiming
      // "full". Interpolating the real values makes that impossible.
      await markerOn(preview, preview.locator("h1, .djp-hd").first(), `The board's deep clay ${themeAfter.palette?.brand} as the hero ground and its tan ${themeAfter.palette?.accent} on the button — not the builder's default green and orange. Headings are the "${themeAfter.font}" pairing, the nearest serif this page can actually load; the model said that out loud rather than pretending it had matched Playfair.`, { place: "after", dy: -10 }),
      await markerOn(preview, preview.locator(".djp-proof-value, .djp-s-proof").first(), `Spacing "${themeAfter.density}" and measure "${themeAfter.width}", from the board's “generous air” and “full measure” rules. Corners "${themeAfter.radius}", from its square swatches.`, { place: "center", dy: 40 }),
    ],
  })
  console.log(`  04 ${r4.width}x${r4.height}`)
  await preview.close()

  // -------------------------------------------------------------------------
  // 5. THE DURABILITY CLAIM — a later turn, with no image, still respects it.
  //
  // This is the whole reason `designNote` exists. The image is gone; if the
  // direction went with it, the feature would be one turn deep.
  // -------------------------------------------------------------------------
  //
  // AND THE TURN HAS TO HAVE ACTUALLY RUN.
  //
  // The first version of this asserted only that `designNote` still existed
  // afterwards — and passed, loudly, on a turn that had FAILED outright
  // ("I couldn't build that — try describing it differently", a schema
  // violation on a 100k-token document). The note had survived because
  // nothing was written at all. That is the opposite of the claim: a note
  // surviving a no-op proves nothing about whether the model still reads it.
  // So the turn's own outcome is read from the turn log, and a failed or
  // blocked turn is retried rather than photographed.
  let afterFollowUp = null
  let themeFinal = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const beforeFollowUp = await readDoc()
    await page.bringToFront()
    const box2 = page.getByPlaceholder(/Make the headline shorter/i)
    await box2.fill(FOLLOW_UP)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    console.log(`  sent follow-up "${FOLLOW_UP}" with NO image (attempt ${attempt}) — waiting…`)
    try {
      afterFollowUp = await waitForStableDoc(beforeFollowUp.project_data)
    } catch (err) {
      console.warn(`  !! attempt ${attempt}: ${err.message}`)
      afterFollowUp = null
    }

    const turns = await (
      await fetch(
        `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnel_step_turns?select=revision,role,source,status,message,error_message&step_id=eq.${STEP}&role=eq.assistant&order=revision.desc&limit=1`,
        { headers: rest },
      )
    ).json()
    const head = turns[0]
    console.log(`  follow-up turn: rev ${head?.revision} [${head?.status}] ${head?.error_message ?? ""}`)
    if (head?.status === "complete" && afterFollowUp) {
      log.push(`follow-up turn rev ${head.revision} [complete]: ${head.message}`)
      themeFinal = themeOf(afterFollowUp)
      break
    }
    log.push(`follow-up attempt ${attempt} did not complete: [${head?.status}] ${head?.error_message ?? "(no error recorded)"}`)
    if (attempt === 3) {
      throw new Error(
        `the follow-up turn never completed after 3 attempts (last: [${head?.status}] ${head?.error_message}) — refusing to caption a pass`,
      )
    }
    await page.waitForTimeout(5000)
  }

  console.log(`  designNote AFTER the follow-up: ${JSON.stringify(themeFinal.designNote)}`)
  log.push(`designNote after follow-up: ${themeFinal.designNote}`)
  log.push(`palette after follow-up: ${JSON.stringify(themeFinal.palette ?? "unset")}`)

  if (!themeFinal.designNote) {
    throw new Error(`the follow-up turn LOST the designNote — refusing to caption a pass`)
  }
  // The turn must have CHANGED the page, or "the brief held across a change"
  // is a claim about a change that never happened.
  if (JSON.stringify(afterFollowUp.project_data) === JSON.stringify(after.project_data)) {
    throw new Error(`the follow-up turn changed nothing on the page — refusing to caption a pass`)
  }
  if (JSON.stringify(themeFinal.palette) !== JSON.stringify(themeAfter.palette)) {
    console.warn(
      `  !! the follow-up changed the palette: ${JSON.stringify(themeAfter.palette)} -> ${JSON.stringify(themeFinal.palette)}`,
    )
  }

  await page.waitForTimeout(3000)
  const raw5 = await shoot(page, "05")
  const r5 = await annotate(raw5, `${OUT}/05-the-direction-survives-later-turns.png`, {
    title: "A later turn, with no image in sight, and the brief still holds",
    subtitle: `“${FOLLOW_UP}” was sent with NO attachment, and it really did rewrite the page (see the receipt in the transcript). The image was never stored — the note is what the model still reads, because the whole document is its context on every turn.`,
    markers: [
      await markerOn(page, page.getByLabel(/design direction/i).first(), `The design note the model is still working from: “${themeFinal.designNote}”`, { place: "left", dy: 6 }),
      await markerOn(page, page.getByText(/Custom colours/i).first(), `And the board's own hexes are still in place: brand ${themeFinal.palette?.brand ?? "unset"}, accent ${themeFinal.palette?.accent ?? "unset"}.`, { place: "left", dy: 26 }),
    ],
  })
  console.log(`  05 ${r5.width}x${r5.height}`)

  // The stability window is a heuristic. Diff the final artifact against the
  // database rather than trusting that the window was long enough.
  const finalRow = await readDoc()
  log.push(`final doc_revision: ${finalRow.doc_revision}, updated_at: ${finalRow.updated_at}`)
  if (finalRow.doc_revision !== afterFollowUp.doc_revision) {
    console.warn(
      `  !! the document moved AFTER the last screenshot (${afterFollowUp.doc_revision} -> ${finalRow.doc_revision}) — shot 05 is stale, re-run`,
    )
  }

  writeFileSync(`${OUT}/capture-log.txt`, log.join("\n") + "\n")
  console.log(`\n  wrote ${OUT}/capture-log.txt`)
} finally {
  await browser.close()
}
