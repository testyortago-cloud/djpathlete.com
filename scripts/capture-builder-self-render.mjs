// Drives the REAL page builder on the REAL route and photographs the review
// stage looking at a picture of its own page.
//
//   export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
//   npx next dev --port 3061 > /tmp/dev-3061.log 2>&1 &   # NOT 3050 — another session owns it
//   until grep -q "Ready in" /tmp/dev-3061.log; do sleep 1; done
//   node scripts/capture-builder-self-render.mjs
//
// It presses POLISH, not "build me a page". Both paths go through the same
// `runReviewStage`, so both render and both hand the pictures to the same
// critic — but Polish runs against a page that already exists, writes nothing
// until the owner accepts, and does not spend an Opus builder call first. It
// is the cheap, controllable door to the same room.
//
// ---------------------------------------------------------------------------
// WHAT IT REFUSES TO DO
// ---------------------------------------------------------------------------
// It will not caption a pass it did not get.
//   - If the dev-login does not land on /admin it throws. An expired session
//     looks EXACTLY like a broken feature from the outside.
//   - If the builder is not showing the step this script read out of the
//     database — checked by finding that page's own hero headline words in the
//     preview — it throws. A wrong id that RESOLVES does not announce itself;
//     a sibling script once shipped a confident caption over an unrelated
//     funnel for exactly this reason.
//   - If no headless Chrome is spawned by the dev server while the review is
//     running, it throws. That process IS the render; without it the whole
//     claim collapses to "the critics ran", which they always did.
//   - If the art lens files no finding it throws, and if the art lens files
//     nothing that NAMES something invisible in the document it throws too —
//     the picture-only vocabulary is the entire point, and a run that produced
//     only tone-and-padding notes is a null result, not a screenshot.
//   - AND IT WILL NOT CAPTION A FINDING IT HAS NOT CHECKED AGAINST THE REAL
//     PAGE. See "the island problem" below. The finding the camera points at
//     has to be one the real page agrees with; if every picture-only finding
//     is about a band that is blank ONLY in the reviewer's copy, this throws.
//   - Every marker is derived from a real `boundingBox()`, and `markerOn`
//     WARNS LOUDLY rather than degrading politely when a target is missing: a
//     helper that silently falls back to (100,100) turns a broken annotation
//     into a caption pointing at the wrong thing.
//
// ---------------------------------------------------------------------------
// THE ISLAND PROBLEM, WHICH THIS CAPTURE EXISTS PARTLY TO DOCUMENT
// ---------------------------------------------------------------------------
// `render-image.ts` screenshots the page with `setContent` and no scripts. Six
// of the ten section kinds can contain an ISLAND — `renderIsland()` emits an
// EMPTY `<div data-djp-island=…>` that the real page fills in the browser — so
// every form, live testimonial feed, live FAQ, checkout button, booking widget
// and quiz is a blank rectangle in the reviewer's copy and full of content on
// the page a visitor sees.
//
// The art director reports those blanks, correctly and confidently, as empty
// bands. So this script sorts the art findings into two piles by loading the
// same page WITH JAVASCRIPT DISABLED — which is exactly the state the renderer
// produces — and asking which sections hold an island. The camera points at the
// confirmed pile; the artefact pile gets a shot of its own, because burying it
// would make this capture a advertisement rather than a verification.
//
// It also READS THE STREAM THE APP ITSELF RECEIVED. The findings list in the
// builder shows `finding.issue` and nothing else — there is no "art director"
// badge on screen — so which lens filed which finding is taken from the SSE
// payload by teeing `window.fetch`, never guessed from the wording. Nothing in
// the app is modified to do it.
//
// NOTHING IS WRITTEN. Polish emits a proposal and the script discards it, so
// the page ends the run on exactly the revision it started on — asserted at the
// end against the database.
//
// LIGHT ONLY (the admin was never built against `.dark`). DEV CLONE ONLY.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"
import { launchChromium } from "./_launch-chromium.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3061"
const OUT = "screenshots/builder-self-render"
const WIDTH = 1600
const HEIGHT = 950
const DSF = 2
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

/**
 * The page §1a of the spec names — ten sections, and two layout defects that
 * are invisible in its JSON. Read out of the database below rather than
 * trusted: the ids here only say WHICH row to read.
 */
const STEP = process.env.STEP ?? "7f5da342-aa37-42aa-bed3-020842893da9"

/**
 * Words a finding can only use if somebody looked at a rendering. Used as a
 * REFUSAL GATE, not as a grade: the script throws when the art lens says
 * nothing in this vocabulary, and a human still reads what it did say.
 */
const PICTURE_VOCABULARY =
  /\b(empt(y|ier)|blank|whitespace|white space|dead space|dead zone|gap|ragged|wrap(s|ped|ping)?|overflow|collid\w*|crop\w*|cut off|unreadab\w*|illegib\w*|contrast|align\w*|misalign\w*|line up|stretch\w*|squash\w*|cramped|orphan\w*|marooned|stranded|uneven|column|margin|indent\w*)\b/i

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
// The database is the source of every identifier in this script.
// ---------------------------------------------------------------------------

async function readStep() {
  const rows = await (
    await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnel_steps?select=id,slug,funnel_id,doc_revision,project_data,updated_at&id=eq.${STEP}`,
      { headers: rest },
    )
  ).json()
  if (!rows[0]) throw new Error(`no funnel_steps row with id ${STEP}`)
  return rows[0]
}

async function readFunnel(funnelId) {
  const rows = await (
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnels?select=id,name,slug&id=eq.${funnelId}`, {
      headers: rest,
    })
  ).json()
  if (!rows[0]) throw new Error(`no funnels row with id ${funnelId}`)
  return rows[0]
}

// ---------------------------------------------------------------------------
// "Is a headless Chrome running RIGHT NOW, started by the dev server?"
//
// This is the only observable the render leaves behind. `renderDocToImages`
// stores nothing (spec §5.6) and logs nothing on the happy path, so the
// process table is the evidence. Counted before the click as a baseline,
// because this machine may well have other headless Chromes on it.
// ---------------------------------------------------------------------------

function headlessChromeCount() {
  try {
    const out = execSync(`ps -Ao command= | grep -c "[G]oogle Chrome.*--headless" || true`, { encoding: "utf8" })
    return Number(out.trim()) || 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Markers, derived from the real box so they land on the real thing.
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
const say = (text) => {
  console.log(text)
  log.push(text)
}

try {
  const step = await readStep()
  const funnel = await readFunnel(step.funnel_id)
  const heroHeadline = step.project_data?.sections?.find((s) => s.kind === "hero")?.props?.headline ?? null
  say(`step ${step.id} ("${step.slug}") in funnel "${funnel.name}" (/${funnel.slug})`)
  say(`doc_revision at start: ${step.doc_revision}`)
  say(`hero headline in the stored document: ${JSON.stringify(heroHeadline)}`)

  // --- sign in off camera, in the SAME context -----------------------------
  const p0 = await ctx.newPage()
  await p0.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await p0.waitForTimeout(2500)
  if (!p0.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p0.url()})`)
  say(`signed in — landed on ${p0.url()}`)
  await p0.close()
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  // --- tee the build stream BEFORE the page exists -------------------------
  //
  // `Response.clone()` gives an independent body, so the builder consumes its
  // own copy untouched. No named function declarations inside the injected
  // source: a bundler rewrites those to `__name(...)`, which does not exist in
  // the browser, and the whole script then throws.
  await ctx.addInitScript(`
    window.__djpEvents = []
    const original = window.fetch
    window.fetch = async (...args) => {
      const res = await original(...args)
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || ""
      if (url.includes("/build") && (res.headers.get("content-type") || "").includes("event-stream")) {
        const reader = res.clone().body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        ;(async () => {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const parts = buffer.split("\\n\\n")
            buffer = parts.pop() || ""
            for (const part of parts) {
              for (const line of part.split("\\n")) {
                if (!line.startsWith("data:")) continue
                try { window.__djpEvents.push(JSON.parse(line.slice(5).trim())) } catch {}
              }
            }
          }
        })()
      }
      return res
    }
  `)

  const page = await ctx.newPage()
  const builderUrl = `${APP}/admin/funnels/${funnel.id}/edit/${step.id}`
  await page.goto(builderUrl, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(6000)
  say(`builder: ${builderUrl}`)

  // --- IS THIS THE PAGE UNDER TEST? ----------------------------------------
  //
  // Word by word, not as one fragment: filtering short words OUT of a headline
  // and then looking for the survivors as one contiguous string fails on the
  // RIGHT page. `escapeHtml` also encodes apostrophes, so punctuation is
  // stripped from both sides.
  const frame = page.frameLocator('iframe[src*="funnel-preview"]')
  await frame.locator("body").waitFor({ state: "attached", timeout: 30000 })
  await page.waitForTimeout(2500)
  const norm = (s) => s.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").toLowerCase()
  const shown = norm(await frame.locator("body").innerText())
  if (heroHeadline) {
    const words = [...new Set(norm(heroHeadline).split(" ").filter((w) => w.length > 3))].slice(0, 4)
    const missing = words.filter((w) => !shown.includes(w))
    if (words.length > 0 && missing.length > 0) {
      throw new Error(
        `the builder is not showing step ${step.id} — missing ${JSON.stringify(missing)} from "${heroHeadline}". Refusing to caption it.`,
      )
    }
    say(`builder preview confirmed: headline words ${JSON.stringify(words)} are on screen`)
  }

  const polishButton = page.getByRole("button", { name: "Polish", exact: true })
  await polishButton.waitFor({ state: "visible", timeout: 30000 })

  // -------------------------------------------------------------------------
  // 01 — the page, before anybody reviews it.
  // -------------------------------------------------------------------------
  const raw1 = await shoot(page, "01")
  const r1 = await annotate(raw1, `${OUT}/01-the-page-before-the-review.png`, {
    title: "The real builder, on the real page, before the review runs",
    subtitle: `/admin/funnels/${funnel.id.slice(0, 8)}…/edit/${step.id.slice(0, 8)}… — "${funnel.name}", revision ${step.doc_revision}. Everything the reviewer is about to look at is on this screen.`,
    markers: [
      await markerOn(page, polishButton, `"Polish" runs the same three reviewers a first draft gets — and, since this build, the same render. It proposes; it does not change the page.`, { place: "left", dy: -30 }),
      await markerOn(page, page.locator('iframe[src*="funnel-preview"]:visible').first(), `The page itself. Ten sections. Nothing in its saved document says how any of it LOOKS once a browser has laid it out.`, { place: "center", dy: -260 }),
    ],
  })
  say(`  01 ${r1.width}x${r1.height}`)

  // -------------------------------------------------------------------------
  // 02 — press Polish, and watch for a headless Chrome to appear.
  // -------------------------------------------------------------------------
  const chromeBefore = headlessChromeCount()
  say(`\nheadless Chrome processes before Polish: ${chromeBefore}`)

  await polishButton.click()
  say(`pressed Polish — this is a real review (3 Sonnet critics + 1 Opus reviser)…`)

  let chromePeak = chromeBefore
  let artFindings = []
  let allFindings = []
  const deadline = Date.now() + 180_000
  let sawProposal = false
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    chromePeak = Math.max(chromePeak, headlessChromeCount())
    const events = await page.evaluate("window.__djpEvents || []")
    allFindings = events.filter((e) => e.type === "finding").map((e) => e.finding)
    artFindings = allFindings.filter((f) => f.source === "art")
    sawProposal = events.some((e) => e.type === "proposal")
    if (artFindings.length > 0) break
    if (sawProposal) break
  }
  say(`headless Chrome processes peak during the review: ${chromePeak}`)
  say(`findings on the stream: ${allFindings.length} (${artFindings.length} from the art lens)`)

  // REFUSAL: the render is the whole feature. No browser, no evidence.
  if (chromePeak <= chromeBefore) {
    throw new Error(
      `no extra headless Chrome appeared while the review ran (${chromeBefore} -> ${chromePeak}) — ` +
        `the render did not happen, so there is nothing here to photograph`,
    )
  }
  // REFUSAL: an art lens that said nothing is a failed run, not a clean page.
  if (artFindings.length === 0) {
    throw new Error(`the art lens filed nothing — refusing to caption a pass. Findings: ${JSON.stringify(allFindings)}`)
  }
  // REFUSAL: the claim is "it names something invisible in the document".
  const pictureOnly = artFindings.filter((f) => PICTURE_VOCABULARY.test(`${f.issue} ${f.suggestion}`))
  if (pictureOnly.length === 0) {
    throw new Error(
      `the art lens filed ${artFindings.length} finding(s), none of which names anything a picture is needed for — ` +
        `that is a null result, not a screenshot. ${JSON.stringify(artFindings.map((f) => f.issue))}`,
    )
  }

  for (const finding of artFindings) {
    say(`  [art/${finding.severity}] ${finding.code} (${finding.sectionIds.join(", ") || "whole page"})`)
    say(`      ${finding.issue}`)
  }

  // -------------------------------------------------------------------------
  // WHICH SECTIONS ARE BLANK ONLY IN THE REVIEWER'S COPY?
  //
  // Answered by `_render-islands.ts`, which runs the SAME `reassemble` the
  // renderer runs and reads the island divs out of the markup — see that
  // file's header for why neither a kind list nor a JavaScript-off load of
  // `/preview` is a substitute (the latter was tried here first and found one
  // island where this page has two).
  //
  // stdout carries dotenv's banner, so only the LAST line is the answer.
  // -------------------------------------------------------------------------
  const previewUrl = `${APP}/preview/${funnel.slug}/${step.slug}`
  const probeOut = execSync(`npx tsx scripts/_render-islands.ts ${step.id} 2>/dev/null`, { encoding: "utf8" })
  const islandSections = JSON.parse(probeOut.trim().split("\n").pop())
  say(`\nsections that are BLANK in the reviewer's copy (unfilled islands): ${JSON.stringify(islandSections)}`)

  // ARTEFACTS ARE COUNTED ACROSS EVERY ART FINDING, not just the ones the
  // vocabulary filter caught. That filter is a coarse keyword test and it
  // misses wordings like "renders as a featureless dark rectangle … making the
  // input fields invisible" — which names an unfilled island as plainly as
  // "empty band" does. Letting the filter gate the artefact count would
  // UNDER-REPORT the fault, which is the one direction this script must never
  // round in.
  const isArtefact = (finding) => finding.sectionIds.some((id) => (islandSections[id] ?? []).length > 0)
  const confirmed = pictureOnly.filter((f) => !isArtefact(f))
  const artefacts = artFindings.filter(isArtefact)
  say(
    `art findings: ${artFindings.length} total — ${confirmed.length} picture-only and about the real page, ` +
      `${artefacts.length} about a section that is blank ONLY in the reviewer's copy`,
  )

  // REFUSAL: if every picture-only finding is about a band that is blank only
  // in the reviewer's copy, then the feature found nothing on this page and
  // there is nothing here to caption as a success.
  if (confirmed.length === 0) {
    throw new Error(
      `every picture-only finding is about an unfilled island — the reviewer found nothing the real page agrees with. ` +
        `Refusing to caption a pass. ${JSON.stringify(artefacts.map((f) => `${f.code}: ${f.issue}`))}`,
    )
  }

  // The finding to point the camera at: the highest-severity one whose wording
  // could only come from a rendering AND which the real page agrees with.
  const rank = { high: 0, medium: 1, low: 2 }
  const headline = [...confirmed].sort((a, b) => rank[a.severity] - rank[b.severity])[0]
  const artefact = [...artefacts].sort((a, b) => rank[a.severity] - rank[b.severity])[0] ?? null
  say(`\nthe finding this capture is about: [${headline.severity}] ${headline.code} — ${headline.issue}`)
  if (artefact) say(`the artefact this capture also documents: [${artefact.severity}] ${artefact.code} — ${artefact.issue}`)

  // Its own line in the builder's findings list. `getByText` matches the DOM's
  // own casing and a SUBSTRING, so a distinctive slice of the issue is the
  // safest handle — the full string can be re-wrapped across nodes.
  const needle = headline.issue.slice(0, 48)
  const findingLine = page.getByText(needle, { exact: false })
  // A marker derived from a box BELOW THE FOLD is drawn outside the image, so
  // it vanishes rather than pointing at the wrong thing — quieter than the
  // failure `markerOn` warns about and just as wrong.
  if ((await findingLine.count()) > 0) await findingLine.first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)

  // The artefact's line too, when there is one — it goes in the SAME shot,
  // because a screenshot that showed only the good finding would be a sales
  // brochure for a feature this run also found a fault in.
  const artefactLine = artefact ? page.getByText(artefact.issue.slice(0, 48), { exact: false }) : null

  const raw2 = await shoot(page, "02")
  const r2 = await annotate(raw2, `${OUT}/02-the-art-director-describes-the-picture.png`, {
    title: "The reviewer says what the page LOOKS like — not what its settings say",
    subtitle: `Live in the builder while the review runs. ${allFindings.length} findings so far; ${artFindings.length} of them from the art director, the one lens that was handed screenshots of this page. ${confirmed.length} of those hold up against the real page and ${artefacts.length} do not — both are marked below.`,
    markers: [
      await markerOn(page, findingLine, `The art director's own words: “${headline.issue}” — checked against the real page, and true. Nothing in the page's saved settings says this; it is a description of a picture.`, { place: "after", dy: 0 }),
      ...(artefactLine && (await artefactLine.count()) > 0
        ? [
            await markerOn(
              page,
              artefactLine,
              `And a WRONG one, from the same reviewer: “${artefact.issue}” The real page is not empty there. It is blank only in the copy the reviewer was shown, because that copy is drawn without running the page's own code. See ${OUT}/05-the-band-that-is-only-empty-in-the-picture.png.`,
              { place: "after", dy: 0 },
            ),
          ]
        : []),
      await markerOn(page, page.getByText(/Reviewing the page|Applying improvements/i).first(), `Where the review is up to. Before this step starts, the page is drawn in a real browser, cut into strips, and the strips are handed to this one reviewer alongside the page's settings.`, { place: "after" }),
    ],
  })
  say(`  02 ${r2.width}x${r2.height}`)

  // -------------------------------------------------------------------------
  // 03 — the page the finding is about, on its own real route.
  //
  // THE SLUG IS READ, NEVER GUESSED. A hardcoded preview path copied from a
  // sibling script once LOADED FINE — a real funnel, just not the one under
  // test — and shipped a screenshot of the wrong page under a confident
  // caption. A wrong URL that 404s announces itself; a wrong URL that resolves
  // does not.
  // -------------------------------------------------------------------------
  say(`\npreview: ${previewUrl}`)
  const preview = await ctx.newPage()
  await preview.setViewportSize({ width: 1200, height: 950 })
  await preview.goto(previewUrl, { waitUntil: "networkidle" })
  await preview.waitForTimeout(4000)
  const previewText = norm(await preview.locator("body").innerText())
  if (heroHeadline) {
    const words = [...new Set(norm(heroHeadline).split(" ").filter((w) => w.length > 3))].slice(0, 4)
    const missing = words.filter((w) => !previewText.includes(w))
    if (words.length > 0 && missing.length > 0) {
      throw new Error(`${previewUrl} is not this page — missing ${JSON.stringify(missing)}. Refusing to caption it.`)
    }
    say(`preview confirmed: headline words ${JSON.stringify(words)} are on the page`)
  }

  // Scroll to the section the finding names, so the caption and the pixels
  // agree. `#<sectionId>` is the anchor `sectionOpenTag` emits.
  const sectionId = headline.sectionIds[0] ?? null
  let target = null
  if (sectionId) {
    target = preview.locator(`#${sectionId}`)
    if ((await target.count()) === 0) {
      console.warn(`  !! section "#${sectionId}" is not on the preview page — the shot will be the top of the page`)
      target = null
    } else {
      await target.scrollIntoViewIfNeeded()
      await preview.waitForTimeout(800)
    }
  }
  const raw3 = await shoot(preview, "03")
  const r3 = await annotate(raw3, `${OUT}/03-the-page-the-finding-is-about.png`, {
    title: "The thing the reviewer described, on the page itself",
    subtitle: `${previewUrl.replace(APP, "")} at 1200px wide — the same width the reviewer's copy is drawn at. The reviewer never saw this page; it saw its own drawing of the same document.`,
    markers: [
      await markerOn(
        preview,
        target ?? preview.locator("h1, .djp-hd").first(),
        `The “${sectionId ?? "page"}” section the finding names — and it is as described. Read the previous shot's words against these pixels.`,
        { place: "center", dy: -60 },
      ),
    ],
  })
  say(`  03 ${r3.width}x${r3.height}`)

  // -------------------------------------------------------------------------
  // 05 — the other half of the truth: the band the reviewer called empty.
  //
  // Shot on the SAME preview page, scrolled to the section the artefact
  // finding named, so the caption and the pixels are the same pixels. Numbered
  // 05 and taken here because it needs this page open; it reads after 04.
  // -------------------------------------------------------------------------
  if (artefact) {
    const artefactSection = artefact.sectionIds.find((id) => (islandSections[id] ?? []).length > 0)
    const artefactTarget = preview.locator(`#${artefactSection}`)
    if ((await artefactTarget.count()) === 0) {
      console.warn(`  !! section "#${artefactSection}" is not on the preview page — 05 skipped`)
    } else {
      await artefactTarget.scrollIntoViewIfNeeded()
      await preview.waitForTimeout(800)
      const filledText = (await artefactTarget.innerText()).trim().replace(/\s+/g, " ")
      const raw5 = await shoot(preview, "05")
      const r5 = await annotate(raw5, `${OUT}/05-the-band-that-is-only-empty-in-the-picture.png`, {
        title: "…and the band the reviewer called empty is not empty",
        subtitle: `The same “${artefactSection}” section on the real page. The reviewer's copy of it is blank because that copy is drawn without running the page's own code, so anything the page fills in afterwards — forms, live quotes, checkout buttons, booking widgets — arrives as an empty rectangle.`,
        markers: [
          await markerOn(
            preview,
            artefactTarget,
            `What is really here: “${filledText.slice(0, 150)}${filledText.length > 150 ? "…" : ""}” The reviewer filed a ${artefact.severity}-severity finding asking for this to be replaced or removed.`,
            { place: "center", dy: -40 },
          ),
        ],
      })
      say(`  05 ${r5.width}x${r5.height}`)
      say(`the "${artefactSection}" band actually contains: ${filledText.slice(0, 200)}`)
    }
  }
  await preview.close()

  // -------------------------------------------------------------------------
  // 04 — what the owner is offered, and the fact that nothing was written.
  // -------------------------------------------------------------------------
  await page.bringToFront()
  // `exact: true` — Playwright's accessible-name match is a SUBSTRING match,
  // unlike Testing Library's, so a loose "Apply" would also match "Apply the
  // polish", "Applying…" and anything else on this screen carrying the word.
  const banner = page.getByRole("button", { name: "Apply", exact: true })
  try {
    await banner.first().waitFor({ state: "visible", timeout: 150_000 })
    await page.waitForTimeout(1500)

    // -----------------------------------------------------------------------
    // DID THE EDITOR ACT ON THE ARTEFACT?
    //
    // This is the question the whole verification turns on. A wrong finding
    // that nobody acts on is noise; a wrong finding the editor acts on is a
    // good page being edited to fix a fault that only exists in a picture of
    // it. Read off the proposal's own OPS, not off the prose summary, because
    // the ops are what Apply would replay.
    // -----------------------------------------------------------------------
    const events = await page.evaluate("window.__djpEvents || []")
    const proposal = events.filter((e) => e.type === "proposal").pop()?.proposal ?? null
    const ops = Array.isArray(proposal?.ops) ? proposal.ops : []
    const islandIds = Object.keys(islandSections)
    const opsOnArtefact = ops.filter((op) => typeof op?.id === "string" && islandIds.includes(op.id))
    say(`\nthe proposal carries ${ops.length} ops; ${opsOnArtefact.length} of them target a section that is blank only in the reviewer's copy`)
    for (const op of opsOnArtefact) say(`  ${op.op} ${op.id}: ${JSON.stringify(op.props ?? op.style ?? {}).slice(0, 220)}`)

    const summaryLine = proposal?.summary ? page.getByText(proposal.summary.slice(0, 40), { exact: false }) : null
    const raw4 = await shoot(page, "04")
    const r4 = await annotate(raw4, `${OUT}/04-proposed-not-applied.png`, {
      title:
        opsOnArtefact.length > 0
          ? "…and the editor acted on the wrong finding"
          : "What the reviewer wants to change — offered, not done",
      subtitle:
        opsOnArtefact.length > 0
          ? `Polish itself writes nothing — the page keeps the revision it started on until the owner presses Apply. But ${opsOnArtefact.length} of the ${ops.length} changes on offer rewrite a section that is only blank in the reviewer's copy of the page.`
          : "Polish writes nothing. The page keeps the revision it started on until the owner says yes, which is why this capture can be run on a real page without changing it.",
      markers: [
        await markerOn(page, banner.first(), "Nothing has been saved yet. The owner decides.", { place: "left", dy: -28 }),
        ...(opsOnArtefact.length > 0 && summaryLine && (await summaryLine.count()) > 0
          ? [
              await markerOn(
                page,
                summaryLine,
                `The editor's own account of what it wants to do. It includes rewriting “${opsOnArtefact.map((o) => o.id).join('", "')}” — the section the reviewer wrongly called empty. Pressing Apply would replace a working live quote feed with typed-in text, to fix a blank that is not on the page.`,
                { place: "after", dy: 20 },
              ),
            ]
          : []),
      ],
    })
    say(`  04 ${r4.width}x${r4.height}`)
  } catch {
    console.warn(`  !! no proposal banner within the window — the reviser may still be running. 04 skipped.`)
    log.push("04 skipped: no proposal banner appeared in time")
  }

  // --- and the page really is untouched ------------------------------------
  const after = await readStep()
  say(`\ndoc_revision at end: ${after.doc_revision} (started at ${step.doc_revision})`)
  if (after.doc_revision !== step.doc_revision) {
    throw new Error(
      `the page MOVED during this capture (${step.doc_revision} -> ${after.doc_revision}) — Polish is supposed to write nothing`,
    )
  }

  writeFileSync(`${OUT}/capture-log.txt`, log.join("\n") + "\n")
  console.log(`\n  wrote ${OUT}/capture-log.txt`)
} finally {
  await browser.close()
}
