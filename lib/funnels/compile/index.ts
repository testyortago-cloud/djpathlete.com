// lib/funnels/compile/index.ts — the publish pipeline.
//
// GrapesJS gives us { html, css }. This turns that into what the public route
// stores and renders: a sanitised node tree plus a scoped stylesheet.
//
// Runs once per publish, never per request.

import { htmlToNodes } from "./sanitize"
import { scopeCss, FUNNEL_ROOT_ID } from "./css-scope"
import { isFatalCompileError, type CompileError, type CompileResult } from "./types"

export interface CompileInput {
  html: string
  css: string
  rootId?: string
}

/**
 * Compiles editor output for publication.
 *
 * Fatal problems (a misconfigured island, unparseable CSS) return `ok: false`
 * so the caller can refuse to publish and show the owner what to fix.
 * Non-fatal ones (a removed off-host embed) come back as `warnings` on a
 * successful compile — the page is still correct, minus that element.
 */
export function compileFunnelStep(input: CompileInput): CompileResult {
  const errors: CompileError[] = []

  const { nodes, errors: htmlErrors } = htmlToNodes(input.html ?? "")
  errors.push(...htmlErrors)

  let css = ""
  try {
    css = scopeCss(input.css ?? "", input.rootId ?? FUNNEL_ROOT_ID)
  } catch (error) {
    errors.push({
      code: "css_parse_failed",
      message: `The page stylesheet could not be processed: ${(error as Error).message}`,
    })
  }

  const fatal = errors.filter(isFatalCompileError)
  if (fatal.length > 0) return { ok: false, errors: fatal }

  return { ok: true, nodes, css, warnings: errors }
}

export { FUNNEL_ROOT_ID }
export * from "./types"
