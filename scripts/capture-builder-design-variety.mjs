// Drives the REAL admin app end-to-end for Task 12 of the 2026-09-13
// design-system build: three funnels, created through the real "New funnel"
// dialog, each handed a deliberately different brief in the "Describe it"
// field — which is composed server-side into the FIRST real chat turn the
// builder fires (`creationPrompt` -> `FunnelBuilder`'s `initialPrompt` effect
// -> the real `/api/admin/funnels/steps/[stepId]/build` route, streamed, same
// as if the owner had typed it themselves). Real model calls, real credits.
//
// Then, on each finished page: a screenshot of the real `/preview/<slug>`
// route (the tone the model actually picked), a screenshot of the SAME route
// after toggling `theme.tone` by hand in the real "Page design" panel (proves
// light/dark repaints and that the controls are reachable without an AI
// turn), and a screenshot of the builder screen itself with that panel open.
//
//   PORT 3061 ONLY — this worktree's own dev server. See the task brief:
//   3050 is a DIFFERENT branch's code in a different session.
//
//   APP=http://localhost:3061 node scripts/capture-builder-design-variety.mjs
//
// DEV CLONE ONLY, refuses any other project ref outright. LIGHT ONLY for the
// admin chrome (never built against `.dark`) — the light/dark pair is for the
// rendered FUNNEL PAGES only, never the builder screen around them.

import { mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3061"
const OUT = "screenshots/builder-design-variety"
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

const BUILDER_W = 1680
const BUILDER_H = 1000
const PREVIEW_W = 1440
const DSF = 2

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

const runId = Date.now().toString(36).slice(-5)

// ---------------------------------------------------------------------------
// The three briefs. Each names an audience, a mood, and concrete design
// vocabulary the widened prompt now understands (palette family, tone,
// density, page shape) — deliberately pointing at three different recipes
// (capture-split, long-form-sales, event) from lib/funnels/sections/prompt.ts.
// Kept under the 500-char "Describe it" cap.
// ---------------------------------------------------------------------------
const BRIEFS = [
  {
    key: "waitlist",
    name: `Morning Mobility Waitlist ${runId}`,
    template: "Capture leads",
    audience: "Busy adults 30-55 who sit all day and want to move better before it becomes a problem",
    description:
      "A calm, minimal waitlist signup for a quiet 15-minute morning mobility routine. No hard sell — one honest paragraph and the form. Airy, spacious, soft neutral colours, gentle and understated, nothing loud.",
  },
  {
    key: "sales",
    name: `Forged Strength Program ${runId}`,
    template: "Sell a program",
    audience: "Men 25-45 who have plateaued and want a serious, structured 12-week strength block",
    description:
      "A bold, intense, long-form sales page for a demanding 12-week strength transformation. Make the full case: the problem, proof it works, the method, pricing, a guarantee, and objections answered. Dark, dramatic, high-contrast, urgent — not soft.",
  },
  {
    key: "camp",
    name: `Summer Sports Camp ${runId}`,
    template: "Fill an event or camp",
    audience: "Parents of kids 8-14 looking for an active, fun summer camp",
    description:
      "A vibrant, playful, family-friendly summer sports camp registration page. Lead with the dates, location and price up front, then what is included. Energetic, colourful, warm and welcoming — this is for excited kids and reassured parents, not athletes.",
  },
]

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
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

/** Marker on a real element for a VIEWPORT (non-full-page) screenshot. */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 70)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

/**
 * Marker on a real element for a FULL-PAGE screenshot. `boundingBox()` is
 * viewport-relative (it moves as the page scrolls); a `fullPage` capture
 * stitches the whole document starting at its own top, so the marker needs
 * DOCUMENT-absolute coordinates instead: `getBoundingClientRect()` plus the
 * current scroll offset. Warns loudly rather than guessing, same rule as
 * `markerOn`.
 */
async function markerOnDoc(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 70)}…"`)
  const rect = await locator
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height }
    })
    .catch(() => null)
  if (!rect) {
    console.warn(`  !! MARKER TARGET HAS NO RECT: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? rect.left + rect.width / 2 : place === "after" ? rect.left + rect.width + 22 : rect.left - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((rect.top + rect.height / 2 + dy) * DSF), caption }
}

async function readDoc(stepId) {
  const rows = await (
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnel_steps?select=project_data&id=eq.${stepId}`, {
      headers: rest,
    })
  ).json()
  return rows[0]?.project_data ?? null
}

/**
 * Poll the DB directly for the first draft landing AND settling — the house
 * pattern from capture-ai-colour-turn.mjs: wait on the DOCUMENT, never on a UI
 * spinner, so a failed turn cannot be captioned as a pass.
 *
 * A first draft is not one write. `FunnelBuilder.tsx` applies the `result`
 * event the moment the page is written, then holds the stream open another
 * 30-40s while the reviewer runs — and a `review` event can write a SECOND,
 * revised document before the turn is really done. Returning on the first
 * non-empty read would risk photographing the pre-review draft. So this waits
 * for the section count to stop changing across several consecutive polls
 * before calling it settled.
 */
async function waitForFirstDraft(stepId, timeoutMs = 340_000) {
  const deadline = Date.now() + timeoutMs
  let lastCount = -1
  let lastJson = null
  let stableSince = null
  while (Date.now() < deadline) {
    const doc = await readDoc(stepId)
    const count = Array.isArray(doc?.sections) ? doc.sections.length : 0
    if (count !== lastCount) {
      console.log(`    …${count} section(s) written so far`)
      lastCount = count
    }
    if (count > 0) {
      const json = JSON.stringify(doc)
      if (json !== lastJson) {
        lastJson = json
        stableSince = Date.now()
      } else if (Date.now() - stableSince >= 20_000) {
        return doc
      }
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`first draft did not land/settle for step ${stepId} within ${timeoutMs / 1000}s — refusing to caption a pass`)
}

async function readTheme(stepId) {
  const doc = await readDoc(stepId)
  return doc?.theme ?? null
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: PREVIEW_W, height: 900 }, deviceScaleFactor: DSF })

const report = []

try {
  // ---- Sign in once, for the whole context. ----
  const p0 = await ctx.newPage()
  await p0.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded" })
  await p0.waitForTimeout(2500)
  if (!p0.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p0.url()})`)
  await p0.close()
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  mkdirSync(OUT, { recursive: true })

  // Filter/offset for resuming a partial run — see the retry note below this
  // script's first real run hit: the third funnel's "New funnel" click landed
  // before the client component had hydrated (a known trap — an enabled
  // button whose handler is not attached yet), and the dialog never opened
  // within the fixed wait. ONLY re-runs a subset without re-spending the
  // model calls the earlier funnels already paid for.
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null
  const briefs = only ? BRIEFS.filter((b) => only.has(b.key)) : BRIEFS

  let n = Number(process.env.START_N ?? 0)
  for (const brief of briefs) {
    console.log(`\n=== ${brief.key}: "${brief.name}" ===`)

    // ---- Create the funnel through the REAL dialog on the REAL board. ----
    const builder = await ctx.newPage()
    await builder.setViewportSize({ width: BUILDER_W, height: BUILDER_H })
    await builder.goto(`${APP}/admin/funnels`, { waitUntil: "load" })
    // Give the client component time to hydrate before the click. A
    // server-rendered "New funnel" button is visible and clickable
    // immediately, but its onClick is not wired until hydration — clicking
    // during that window is a silent no-op, and the dialog then never opens.
    await builder.waitForTimeout(1500)

    const dialog = builder.getByRole("dialog")
    // Click, then retry a few times if the dialog does not appear — the same
    // hydration race, made recoverable instead of a hard 30s failure.
    let dialogOpen = false
    for (let attempt = 1; attempt <= 4 && !dialogOpen; attempt++) {
      await builder.getByRole("button", { name: "New funnel" }).click()
      dialogOpen = await dialog
        .waitFor({ state: "visible", timeout: 6000 })
        .then(() => true)
        .catch(() => false)
      if (!dialogOpen) console.warn(`  !! "New funnel" click #${attempt} did not open the dialog — retrying`)
    }
    if (!dialogOpen) throw new Error(`the "New funnel" dialog never opened for ${brief.key} after 4 attempts`)

    const slug = `${brief.key}-${runId}`
    await dialog.locator("#funnel-name").fill(brief.name)
    await dialog.locator("#funnel-slug").fill(slug)
    await dialog.getByRole("radio", { name: brief.template }).click()
    await dialog.locator("#funnel-audience").fill(brief.audience)
    await dialog.locator("#funnel-description").fill(brief.description)

    const createBtn = dialog.getByRole("button", { name: "Create funnel" })
    if (!(await createBtn.isEnabled())) throw new Error(`"Create funnel" stayed disabled for ${brief.key}`)
    await createBtn.click()

    await builder.waitForURL(/\/admin\/funnels\/[^/]+\/edit\/[^/?]+/, { timeout: 15000 })
    const match = builder.url().match(/\/admin\/funnels\/([^/]+)\/edit\/([^/?]+)/)
    if (!match) throw new Error(`could not parse funnel/step id from ${builder.url()}`)
    const [, funnelId, stepId] = match
    console.log(`  created funnel ${funnelId} / step ${stepId} / slug "${slug}"`)

    // ---- Wait for the REAL first chat turn (the composed brief) to land. ----
    console.log(`  waiting for the builder's first draft (real model call)…`)
    const doc = await waitForFirstDraft(stepId)
    const sectionKinds = doc.sections.map((s) => s.kind).join(", ")
    const asBuiltTone = doc.theme?.tone ?? "light"
    console.log(`  first draft: ${doc.sections.length} sections [${sectionKinds}], theme.tone="${asBuiltTone}"`)

    await builder.waitForTimeout(3000)
    await hideFloatingChrome(builder)
    await builder.mouse.move(4, 4)

    // Open the real "Page design" panel by hand.
    await builder.getByRole("button", { name: "Page design" }).click()
    await builder.waitForTimeout(500)

    n += 1
    const rawBuilder = `${OUT}/.raw-builder.png`
    await builder.screenshot({ path: rawBuilder })
    const builderOut = `${OUT}/${String(n).padStart(2, "0")}-${brief.key}-builder-theme-panel.png`
    await annotate(rawBuilder, builderOut, {
      title: `"${brief.name}" — built from a typed brief, controls reachable by hand`,
      subtitle: `Brief given: "${brief.description}"`,
      markers: [
        await markerOn(
          builder,
          builder.getByText(brief.description, { exact: false }).first(),
          `What the owner typed when creating this page — the AI's actual instructions, sent to the real chat.`,
          { place: "after" },
        ),
        await markerOn(
          builder,
          builder.locator('iframe[src*="funnel-preview"]:visible').first(),
          `The page the AI just wrote from that brief: ${doc.sections.length} sections (${sectionKinds}).`,
          { place: "center", dy: -250 },
        ),
        await markerOn(
          builder,
          builder.locator("text=Palette").first(),
          `"Page design" panel — the new colour, font, spacing and tone controls. Nothing here needs the AI; a person can click these directly.`,
          { place: "left", dx: -10 },
        ),
      ],
    })
    console.log(`  wrote ${builderOut}`)

    // ---- Preview at the tone the model actually chose. ----
    const preview = await ctx.newPage()
    await preview.setViewportSize({ width: PREVIEW_W, height: 900 })
    await preview.goto(`${APP}/preview/${slug}`, { waitUntil: "domcontentloaded" })
    await preview.waitForTimeout(2500)
    await hideFloatingChrome(preview)
    await preview.mouse.move(4, 4)
    await preview.waitForTimeout(200)

    n += 1
    const rawAsBuilt = `${OUT}/.raw-preview-as-built.png`
    await preview.screenshot({ path: rawAsBuilt, fullPage: true })
    const asBuiltOut = `${OUT}/${String(n).padStart(2, "0")}-${brief.key}-preview-${asBuiltTone}.png`
    await annotate(rawAsBuilt, asBuiltOut, {
      title: `"${brief.name}"`,
      subtitle: `The real page, on its real address /preview/${slug}. The AI chose a "${asBuiltTone}" look and a ${doc.sections.length}-section layout for this brief, on its own.`,
      markers: [],
    })
    console.log(`  wrote ${asBuiltOut}`)

    // ---- Toggle the tone BY HAND (no AI call — the real ThemePanel control), then re-shoot. ----
    const otherTone = asBuiltTone === "dark" ? "light" : "dark"
    await builder.bringToFront()
    await builder.locator("#theme-tone").selectOption(otherTone)
    await builder.waitForTimeout(2500)
    const themeAfterToggle = await readTheme(stepId)
    if (themeAfterToggle?.tone !== otherTone) {
      throw new Error(
        `toggling the Tone control did not save — stored tone is "${themeAfterToggle?.tone}", expected "${otherTone}" — refusing to caption a pass`,
      )
    }

    await preview.reload({ waitUntil: "domcontentloaded" })
    await preview.waitForTimeout(2500)
    await hideFloatingChrome(preview)
    await preview.mouse.move(4, 4)
    await preview.waitForTimeout(200)

    n += 1
    const rawToggled = `${OUT}/.raw-preview-toggled.png`
    await preview.screenshot({ path: rawToggled, fullPage: true })
    const toggledOut = `${OUT}/${String(n).padStart(2, "0")}-${brief.key}-preview-${otherTone}.png`
    await annotate(rawToggled, toggledOut, {
      title: `Same page, repainted "${otherTone}" by hand`,
      subtitle: `No AI call for this — an owner switched "Tone" from "${asBuiltTone}" to "${otherTone}" in the Page design panel and every colour on the page followed.`,
      markers: [],
    })
    console.log(`  wrote ${toggledOut}`)

    // Put the tone back so the stored draft still reflects what the AI chose.
    await builder.locator("#theme-tone").selectOption(asBuiltTone)
    await builder.waitForTimeout(1500)

    await preview.close()
    await builder.close()

    report.push({
      key: brief.key,
      name: brief.name,
      slug,
      funnelId,
      stepId,
      brief: brief.description,
      sectionCount: doc.sections.length,
      sectionKinds,
      asBuiltTone,
      theme: doc.theme,
    })
  }

  writeFileSync(`${OUT}/build-summary.json`, JSON.stringify(report, null, 2))
  console.log(`\nWrote ${OUT}/build-summary.json`)
} finally {
  await browser.close()
}
