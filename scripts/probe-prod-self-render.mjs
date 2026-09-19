// Presses POLISH once on a real PRODUCTION page and records what the stream said.
//
//   node --env-file=.env.prod scripts/probe-prod-self-render.mjs
//
// ───────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
// ───────────────────────────────────────────────────────────────────────────
// The page builder's self-render (merged 2026-09-15, `56258b74`) had never run
// in production: `funnel_step_turns` held 198 turns whose most recent was
// 2026-09-14 19:46 UTC, the day BEFORE the merge. The feature FAILS SOFT — if
// `@sparticuz/chromium` did not bundle, the dynamic import throws,
// `launchRenderBrowser` catches it and returns null, and the review runs on
// JSON exactly as it did before. A permanent invisible no-op.
//
// The one line that would settle it is `console.info("[funnels/render] N images
// of a Hpx page …")` in lib/funnels/render-image.ts. It is console-only, so
// Vercel's logs are the only place it lands — and this machine's Vercel login
// (`tayawaaean`) can see exactly two scopes, `tayawaaeans-projects` and
// `solar-x-canada`. The production project lives under `darren-pauls-projects`,
// which is not merely forbidden to this login, it is not visible to it at all
// (`vercel ls --scope darren-pauls-projects` → "The specified scope does not
// exist"). So the log line cannot be read from here, by anyone, today.
//
// ───────────────────────────────────────────────────────────────────────────
// WHAT THIS MEASURES INSTEAD, AND WHAT THAT IS WORTH
// ───────────────────────────────────────────────────────────────────────────
// POLISH WRITES NO ROW. `handlePolish` runs `runReviewStage` in mode "propose",
// whose early return is commented "No `appendTurn`, so no row" — so there is no
// database artefact to read afterwards either. The stream IS the only evidence,
// which is why this script captures it rather than the screen.
//
// Two signals come off that stream, and NEITHER is the log line. Both are
// stated as inference in the output, never as proof:
//
//   1. TIMING. `{phase:"reviewing"}` is emitted immediately, BEFORE the render.
//      The gap from there to the first `finding` contains renderDocToImages()
//      plus the first critic call. A browser that launches, paints and shoots
//      N tiles costs seconds; a failed dynamic import costs milliseconds. The
//      gap does not separate the two terms, so it is only ever corroborating.
//
//   2. PICTURE-ONLY CLAIMS. An art finding that reads a hex value off the page,
//      places something spatially ("the card sits in the upper half of the
//      band"), or mentions the dashed island placeholders — which exist ONLY in
//      the render — cannot be derived from the JSON the other two lenses read.
//      This is the same inference the A/B harness itself is built on.
//
// Calibrate both against `scripts/ab-self-render-critics.ts` on the dev clone,
// where arm A (no render) and arm B (render) run over the same document.
//
// ───────────────────────────────────────────────────────────────────────────
// SAFETY
// ───────────────────────────────────────────────────────────────────────────
// PRODUCTION ONLY, and it refuses any other Supabase project ref outright, so
// it cannot be pointed at the dev clone by accident.
//
// IT CLICKS POLISH AND NOTHING ELSE. Polish PROPOSES: the route's own comment
// is "THE POLISH BUTTON PROPOSES. It reads the page, decides what it would
// change, and writes nothing". Apply is what saves, and Apply is never clicked
// here — nor is Discard, because there is nothing to discard that outliving the
// browser does not already throw away. No page content is changed, no revision
// moves, and no funnel is published. The cost is model tokens and one prod
// render.
//
// SESSION IS ASSERTED FIRST, BEFORE ANY CONCLUSION IS DRAWN. A minted admin JWT
// is short-lived, and when it expires the admin routes redirect to /login — a
// probe without this check would photograph a login page and report the render
// as broken, which mimics exactly the fault it is looking for.
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`.

import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { encode } from "next-auth/jwt"

const PROD_REF = "epzuvzkokzqtzomeyoha"
const APP = process.env.APP ?? "https://www.darrenjpaul.com"

const ADMIN_ID = "00000000-0000-0000-0000-000000000001"
const ADMIN_EMAIL = "admin@darrenjpaul.com"

// The richest prod document: 8 sections / 8315 bytes of project_data, the
// largest on the estate. More page height means more tiles, which makes both
// signals above louder. It is `kind='page'`, so the builder lives under
// /admin/pages/<funnelId>/edit/<stepId>.
const FUNNEL_ID = process.env.FUNNEL_ID ?? "3ec1a2d1-2111-45e5-b433-76158d97a3e4"
const STEP_ID = process.env.STEP_ID ?? "d3bd4818-7cac-4bf2-a0ae-b505cffbb47c"
const BUILDER_PATH = process.env.BUILDER_PATH ?? `/admin/pages/${FUNNEL_ID}/edit/${STEP_ID}`

const OUT = "screenshots/prod-self-render-probe"

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
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET / NEXTAUTH_SECRET missing from .env.prod")

  const token = await encode({
    secret,
    salt: "__Secure-authjs.session-token",
    token: { id: ADMIN_ID, sub: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", name: "Darren Paul" },
  })

  const browser = await launchChromium()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
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

  // Tee the build route's streaming response, timestamping every chunk as it
  // lands. Installed BEFORE any navigation so it is in place for the click.
  //
  // `response.clone()` rather than reading the original: the builder consumes
  // the real body to drive its own UI, and stealing it would break the page
  // under test. A clone is exactly what tee-ing a stream is for.
  //
  // NO NAMED FUNCTION IS DECLARED INSIDE THIS EVALUATED SOURCE. Bundlers
  // rewrite a named function in an injected script into a `__name(fn, "…")`
  // helper that does not exist in the browser, and the whole script throws.
  await ctx.addInitScript(() => {
    window.__polish = { t0: 0, chunks: [], done: false, error: null }
    const original = window.fetch
    window.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "")
      const response = await original(...args)
      if (!url.includes("/build")) return response
      window.__polish.t0 = Date.now()
      const clone = response.clone()
      void (async () => {
        try {
          const reader = clone.body.getReader()
          const decoder = new TextDecoder()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            window.__polish.chunks.push({
              at: Date.now() - window.__polish.t0,
              text: decoder.decode(value, { stream: true }),
            })
          }
        } catch (err) {
          window.__polish.error = String(err)
        } finally {
          window.__polish.done = true
        }
      })()
      return response
    }
  })

  const page = await ctx.newPage()
  page.on("console", (m) => {
    const t = m.text()
    if (t.includes("[funnels/")) console.log(`  browser console: ${t}`)
  })

  // ── Session assertion FIRST. Fail loudly, before judging anything. ──
  await page.goto(`${APP}/api/auth/session`, { waitUntil: "domcontentloaded" })
  const sessionText = await page.locator("body").innerText()
  let session
  try {
    session = JSON.parse(sessionText)
  } catch {
    throw new Error(`/api/auth/session did not return JSON. Got: ${sessionText.slice(0, 200)}`)
  }
  if (session?.user?.role !== "admin") {
    throw new Error(`SESSION NOT ADMIN — refusing to press anything. Body: ${sessionText.slice(0, 300)}`)
  }
  console.log(`  session OK: ${session.user.email} / role=${session.user.role}`)

  // ── The builder ──
  await page.goto(`${APP}${BUILDER_PATH}`, { waitUntil: "networkidle" })
  if (!page.url().includes("/edit/")) {
    throw new Error(`redirected away from the builder — now at ${page.url()}`)
  }
  console.log(`  builder open: ${page.url()}`)

  const polish = page.getByRole("button", { name: "Polish", exact: true })
  await polish.waitFor({ state: "visible", timeout: 30_000 })

  // HYDRATION, NOT VISIBILITY. An enabled button whose React handler has not
  // been attached yet swallows the click silently and the probe then reports a
  // render failure that never happened. The proof of hydration is a request
  // actually leaving: click, wait briefly for the fetch wrapper to see a /build
  // POST, and click again if it did not.
  let fired = false
  for (let attempt = 1; attempt <= 3 && !fired; attempt++) {
    await polish.click()
    try {
      await page.waitForFunction("window.__polish && window.__polish.t0 > 0", null, { timeout: 5_000 })
      fired = true
    } catch {
      console.log(`  click ${attempt} produced no request (not hydrated yet) — retrying`)
    }
  }
  if (!fired) throw new Error("Polish never issued a /build request after 3 clicks")
  console.log("  Polish pressed; the stream is open. Waiting for the terminal event…")

  // The route's own budget is maxDuration = 300s. Give it that plus slack.
  await page.waitForFunction("window.__polish && window.__polish.done", null, { timeout: 330_000 })

  const captured = await page.evaluate("window.__polish")

  // Reassemble the chunk stream into whole events, each keeping the arrival
  // time of the chunk that COMPLETED it.
  //
  // THE WIRE FORMAT IS SSE, NOT NDJSON. `encodeBuildStreamEvent` emits
  // `data: {json}\n\n`, and the heartbeat is an SSE comment (`:`...). Parsing
  // this as one-JSON-object-per-line finds nothing at all and would report a
  // perfectly healthy render as a dead stream.
  const events = []
  let buffer = ""
  for (const chunk of captured.chunks) {
    buffer += chunk.text
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith(":")) {
        events.push({ at: chunk.at, heartbeat: true })
        continue
      }
      if (!trimmed.startsWith("data:")) {
        events.push({ at: chunk.at, raw: trimmed })
        continue
      }
      const payload = trimmed.slice("data:".length).trim()
      try {
        events.push({ at: chunk.at, event: JSON.parse(payload) })
      } catch {
        events.push({ at: chunk.at, raw: payload })
      }
    }
  }

  const at = (predicate) => events.find(predicate)?.at ?? null
  const reviewingAt = at((e) => e.event?.type === "phase" && e.event.phase === "reviewing")
  const firstFindingAt = at((e) => e.event?.type === "finding")
  const findings = events.filter((e) => e.event?.type === "finding").map((e) => e.event.finding)
  const terminal = events.filter((e) => ["proposal", "fail", "error"].includes(e.event?.type))

  const lines = []
  const say = (s) => {
    lines.push(s)
    console.log(s)
  }

  say(`PROD SELF-RENDER PROBE — ${new Date().toISOString()}`)
  say(`app: ${APP}   builder: ${BUILDER_PATH}`)
  say(`session: ${session.user.email} / ${session.user.role}`)
  say("")
  const heartbeats = events.filter((e) => e.heartbeat).length
  say(`stream events: ${events.length} (${heartbeats} heartbeats)   findings: ${findings.length}`)
  say(`phase:reviewing at   ${reviewingAt ?? "—"} ms`)
  say(`first finding at     ${firstFindingAt ?? "—"} ms`)
  say(
    `GAP (render + first critic call): ${
      reviewingAt !== null && firstFindingAt !== null ? `${firstFindingAt - reviewingAt} ms` : "—"
    }`,
  )
  say(`total stream duration: ${captured.chunks.at(-1)?.at ?? "—"} ms`)
  if (captured.error) say(`stream reader error: ${captured.error}`)
  say("")
  say("── findings, in arrival order ──")
  for (const f of findings) {
    say(`  [${f.source ?? "?"}/${f.severity ?? "?"}] ${f.code ?? "?"} (${(f.sectionIds ?? []).join(",") || "page"})`)
    if (f.issue) say(`      issue:      ${f.issue}`)
    if (f.suggestion) say(`      suggestion: ${f.suggestion}`)
  }
  say("")
  say("── terminal events ──")
  for (const t of terminal) say(`  ${t.at} ms  ${t.event.type}  ${JSON.stringify(t.event).slice(0, 400)}`)

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")
  const file = join(OUT, `polish-stream-${STEP_ID.slice(0, 8)}-${stamp}.txt`)
  writeFileSync(file, `${lines.join("\n")}\n\n── raw events ──\n${JSON.stringify(events, null, 2)}\n`)
  say("")
  say(`written: ${file}`)
  say("NOTHING WAS APPLIED. Polish proposes; Apply was never clicked.")

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
