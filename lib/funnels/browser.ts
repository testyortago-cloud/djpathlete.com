// lib/funnels/browser.ts — a headless Chrome, or honestly nothing.
//
// ---------------------------------------------------------------------------
// NO BROWSER IS A NORMAL OUTCOME, NOT AN ERROR.
// ---------------------------------------------------------------------------
// This exists so the review stage can look at the page it is reviewing. That
// is an improvement to a stage that already works without it, so a dev machine
// with no Chrome, a platform that will not launch one, or a cold start that ran
// out of room must all end as `null` and a review that runs on JSON exactly as
// it did before. Nothing in here throws for the caller to catch.
//
// THE PORT IS DELIBERATELY NARROW. `render-image.ts` sees only `RenderBrowser`
// and `RenderPage` — four methods — so it contains no puppeteer code and its
// tiling and assembly logic is testable with a fake instead of a browser.
//
// PUPPETEER IS IMPORTED DYNAMICALLY. The build route is the hottest route in
// the builder and most of its turns never render anything.

import { existsSync } from "node:fs"
import { SECTION_RENDER_TIMEOUT_MS, SECTION_RENDER_VIEWPORT_WIDTH } from "@/lib/funnels/sections/builder-config"

export interface RenderPage {
  setContent(html: string): Promise<void>
  /**
   * True when every downloadable family THE PAGE'S TEXT ACTUALLY USES has a
   * loaded face — i.e. when the type in the picture is the type a visitor sees.
   *
   * NOT "every family in `families` loaded". Only one of the five `FONT_STACKS`
   * pairings names Lexend Exa, and a browser downloads a webfont only when
   * something on the page asks for it, so the every-family form reported false
   * on every render whose typography was perfectly correct (measured
   * 2026-09-14: Exa false, Deca true, Mono true, on a page whose type was
   * right). `families` is the list of faces this render DOWNLOADS, used to tell
   * a webfont apart from a system face — not a list of faces to demand.
   */
  fontsInUseLoaded(families: readonly string[]): Promise<boolean>
  pageHeight(): Promise<number>
  /** `null` clip means the whole page. */
  shoot(clip: { y: number; height: number } | null): Promise<Buffer>
}

export interface RenderBrowser {
  newPage(): Promise<RenderPage>
  close(): Promise<void>
}

export type LaunchRenderBrowser = () => Promise<RenderBrowser | null>

/**
 * Where a local Chrome lives. Exported for its own test because a resolver
 * that silently picks the wrong binary — or `""` — is indistinguishable from
 * a platform that has no browser.
 */
const LOCAL_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
] as const

export function chromeExecutablePath(
  env: NodeJS.ProcessEnv,
  candidates: readonly string[] = LOCAL_CHROME_CANDIDATES,
): string | null {
  const explicit = env.PUPPETEER_EXECUTABLE_PATH
  // An empty string is a set-but-blank env var, which would launch `""`.
  if (typeof explicit === "string" && explicit.length > 0) return explicit
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function isServerless(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME)
}

export const launchRenderBrowser: LaunchRenderBrowser = async () => {
  try {
    const puppeteer = (await import("puppeteer-core")).default

    // @sparticuz/chromium ships a LINUX binary, so this split is not a
    // preference — it is the only arrangement that works in both places.
    const launchOptions = isServerless(process.env)
      ? await (async () => {
          const chromium = (await import("@sparticuz/chromium")).default
          return {
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: true as const,
          }
        })()
      : (() => {
          const executablePath = chromeExecutablePath(process.env)
          return executablePath ? { executablePath, headless: true as const, args: [] as string[] } : null
        })()

    if (!launchOptions) return null

    const browser = await puppeteer.launch({ ...launchOptions, timeout: SECTION_RENDER_TIMEOUT_MS })

    return {
      async newPage(): Promise<RenderPage> {
        const page = await browser.newPage()
        await page.setViewport({ width: SECTION_RENDER_VIEWPORT_WIDTH, height: 900, deviceScaleFactor: 1 })
        return {
          async setContent(html) {
            // "load", never "networkidle0": the font stylesheet is a remote
            // request, and in a container with no egress `networkidle0` waits
            // for a quiet period that never begins. The timeout is the bound.
            await page.setContent(html, { waitUntil: "load", timeout: SECTION_RENDER_TIMEOUT_MS })
          },
          async fontsInUseLoaded(families) {
            // A STRING, not a function literal. Bundlers rewrite a named
            // function inside an evaluate callback into a helper that does not
            // exist in the browser, and the whole evaluate then throws.
            //
            // TWO STEPS, AND NEITHER IS `document.fonts.check` ALONE.
            //
            // 1. WHICH of the downloadable families does this page's text
            //    actually ask for? Walk the text nodes and read the computed
            //    `font-family` of the element each one sits in — `var()` is
            //    already substituted at computed-value time, so this is the
            //    resolved stack. A family nothing asks for is never downloaded
            //    and is not part of what the picture shows.
            //
            // 2. Did each of those arrive? `document.fonts.check` answers the
            //    WRONG question here: it returns TRUE for a family that is not
            //    in the set at all, so a render whose font stylesheet never
            //    arrived — the exact degrade this flag exists to report — would
            //    read as faithful (verified in Chrome: a page using an
            //    undeclared "Lexend Exa" answers check() true). Ask the
            //    FontFaceSet instead: the family must be declared AND have at
            //    least one face with status "loaded". One loaded face is the
            //    right bar, not all of them — a Google `css2` stylesheet
            //    declares a face per unicode subset and downloads only the
            //    subsets the copy on the page actually needs.
            //
            // No used families at all (a page of system faces) is faithful:
            // there was nothing to download and nothing to fall back from.
            const probe = `(async () => {
              await document.fonts.ready
              const wanted = ${JSON.stringify(families)}
              const used = new Set()
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
              let node = walker.nextNode()
              while (node) {
                if (node.nodeValue && node.nodeValue.trim() && node.parentElement) {
                  const stack = getComputedStyle(node.parentElement).fontFamily
                  for (const family of wanted) { if (stack.includes(family)) used.add(family) }
                }
                node = walker.nextNode()
              }
              const loaded = new Set()
              document.fonts.forEach((face) => {
                if (face.status === 'loaded') loaded.add(face.family.replace(/^['"]|['"]$/g, ''))
              })
              return [...used].every((family) => loaded.has(family))
            })()`
            return Boolean(await page.evaluate(probe))
          },
          async pageHeight() {
            return Number(await page.evaluate("document.documentElement.scrollHeight"))
          },
          async shoot(clip) {
            // `clip` and `fullPage` are MUTUALLY EXCLUSIVE on this
            // puppeteer-core — passing both throws "'clip' and 'fullPage' are
            // mutually exclusive" (verified against puppeteer-core@25.11.0,
            // caught by render-image.browser.test.ts's real-document test).
            // A `clip` alone is NOT bounded by the viewport: puppeteer
            // captures beyond it, so a slice below the fold still works.
            const shot = await page.screenshot(
              clip
                ? { type: "png", clip: { x: 0, y: clip.y, width: SECTION_RENDER_VIEWPORT_WIDTH, height: clip.height } }
                : { type: "png", fullPage: true },
            )
            return Buffer.from(shot)
          },
        }
      },
      async close() {
        await browser.close()
      },
    }
  } catch (error) {
    console.warn("[funnels/browser] could not launch:", error)
    return null
  }
}
