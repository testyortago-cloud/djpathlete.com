import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * Any function that can call a model must bind OPENROUTER_API_KEY, not only
 * ANTHROPIC_API_KEY.
 *
 * Firebase injects only the secrets a function lists in its own `secrets`, so a
 * declared-but-unbound secret is simply absent from process.env inside it. For
 * OPENROUTER_API_KEY that absence is silent: isOpenRouterConfigured() reads
 * false and callAgent / createMessageCompat go straight to direct Anthropic,
 * which fails with "Your credit balance is too low" now that the Anthropic
 * account has no credit. The OpenRouter migration shipped with fourteen
 * functions in exactly that state (brollGeneration, videoVision, imageVision,
 * runJob and ten more): each bound anthropicApiKey in a hand-written list, and
 * only `allSecrets` had been given openrouterApiKey.
 *
 * The rule pinned here is the one that is checkable from the source: every
 * secrets array that carries anthropicApiKey also carries openrouterApiKey.
 * Binding the Anthropic key is how this file already marks a function as a
 * model caller, so the rule follows that marker instead of trying to trace
 * every handler's imports.
 *
 * Source-text contract, like __tests__/lib/cron-delegator-timeout-contract.test.ts:
 * importing index.ts registers every Firebase trigger as a side effect, so the
 * only way to check its options is to read them.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const INDEX_PATH = join(HERE, "..", "index.ts")

/**
 * index.ts with comments removed but every newline kept, so line numbers in
 * failure messages still match the file and a comment that mentions
 * openrouterApiKey (googleAdsSecrets has comments inside its array) cannot
 * satisfy the check.
 *
 * ONE LEFT-TO-RIGHT PASS THAT KNOWS ABOUT STRINGS, not a chain of regexes. The
 * first version stripped block comments before line comments and could not see
 * strings, so `// see blog/*` paired with the `*` + `/` opening a later
 * `"*\/15 * * * *"` cron schedule and silently deleted every array in between.
 */
function codeOf(raw: string): string {
  let out = ""
  let i = 0
  while (i < raw.length) {
    const c = raw[i]
    const next = raw[i + 1]
    if (c === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++
      continue
    }
    if (c === "/" && next === "*") {
      const end = raw.indexOf("*/", i + 2)
      const stop = end === -1 ? raw.length : end + 2
      out += raw.slice(i, stop).replace(/[^\n]/g, "")
      i = stop
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      while (j < raw.length && raw[j] !== c) j += raw[j] === "\\" ? 2 : 1
      out += raw.slice(i, j + 1)
      i = j + 1
      continue
    }
    out += c
    i++
  }
  return out
}

type SecretsArray = {
  /** The top-level `const` or `export const` the array belongs to. */
  owner: string
  line: number
  tokens: string[]
}

function lineAt(code: string, index: number): number {
  return code.slice(0, index).split("\n").length
}

/** Every flat `[ ... ]` literal, named by the top-level declaration it sits in. */
function arrayLiterals(code: string): SecretsArray[] {
  const decls: { name: string; at: number }[] = []
  const declRe = /^(?:export )?const (\w+)/gm
  let d: RegExpExecArray | null
  while ((d = declRe.exec(code)) !== null) decls.push({ name: d[1], at: d.index })

  const out: SecretsArray[] = []
  const arrRe = /\[([^[\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = arrRe.exec(code)) !== null) {
    const at = m.index
    const owner = decls.filter((x) => x.at < at).pop()?.name ?? "(top of file)"
    const tokens = m[1]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    out.push({ owner, line: lineAt(code, at), tokens })
  }
  return out
}

describe("codeOf", () => {
  it("does not pair a /* inside a line comment with the */ of a cron string", () => {
    // index.ts has several `schedule: "*/15 * * * *"` strings. A regex stripper
    // that removed block comments first read `// see blog/*` as the start of a
    // comment ending inside the next cron string, and deleted every secrets
    // array in between — so a missing binding there passed unseen.
    const src = [
      "// see blog/*",
      "export const a = onDocumentCreated({ secrets: [anthropicApiKey] })",
      'export const b = onSchedule({ schedule: "*/15 * * * *" })',
    ].join("\n")
    expect(codeOf(src)).toContain("[anthropicApiKey]")
  })

  it("still removes real comments, and keeps every newline", () => {
    const src = ["const x = [a, /* openrouterApiKey */ b] // openrouterApiKey", "/*", "  [c]", "*/", "const y = [d]"].join("\n")
    const out = codeOf(src)
    expect(out).not.toContain("openrouterApiKey")
    expect(out).not.toContain("[c]")
    expect(out).toContain("[d]")
    expect(out.split("\n")).toHaveLength(5)
  })
})

describe("functions/src/index.ts — every model-calling function binds OPENROUTER_API_KEY", () => {
  const code = codeOf(readFileSync(INDEX_PATH, "utf8"))
  const arrays = arrayLiterals(code)
  const anthropicArrays = arrays.filter((a) => a.tokens.includes("anthropicApiKey"))

  it("declares both keys under their real secret names", () => {
    // The checks below match identifiers. If openrouterApiKey were ever bound
    // to a different secret name, they would pass while the env var the code
    // reads stayed unset.
    expect(code).toMatch(/const openrouterApiKey = defineSecret\("OPENROUTER_API_KEY"\)/)
    expect(code).toMatch(/const anthropicApiKey = defineSecret\("ANTHROPIC_API_KEY"\)/)
  })

  it("puts openrouterApiKey in allSecrets", () => {
    const all = arrays.find((a) => a.owner === "allSecrets")
    expect(all, "could not find the `const allSecrets = [...]` literal").toBeDefined()
    expect(all!.tokens).toContain("anthropicApiKey")
    expect(all!.tokens).toContain("openrouterApiKey")
  })

  it("binds openrouterApiKey wherever anthropicApiKey is bound", () => {
    const offenders = anthropicArrays
      .filter((a) => !a.tokens.includes("openrouterApiKey"))
      .map((a) => `${a.owner} (functions/src/index.ts:${a.line})`)

    expect(
      offenders,
      "these functions bind anthropicApiKey but not openrouterApiKey, so every model call in them " +
        "skips OpenRouter and goes straight to direct Anthropic",
    ).toEqual([])
  })

  it("parses a realistic number of secrets arrays (guards the parser itself)", () => {
    // A parsing bug that found nothing would make the check above pass on an
    // empty list. index.ts has ~80 `secrets:` options and ~60 of them are
    // written inline as array literals.
    const secretsOptions = code.match(/\bsecrets:\s*/g) ?? []
    const inlineLiterals = code.match(/\bsecrets:\s*\[/g) ?? []
    expect(secretsOptions.length).toBeGreaterThan(60)
    expect(inlineLiterals.length).toBeGreaterThan(50)

    // Presence controls: the parser has to name both a shared const and
    // individual exported functions, or an offender could be misattributed.
    expect(anthropicArrays.length).toBeGreaterThanOrEqual(15)
    const owners = anthropicArrays.map((a) => a.owner)
    expect(owners).toContain("allSecrets")
    expect(owners).toContain("blogImageGeneration")
    expect(owners).toContain("runJob")
    expect(owners).toContain("voiceDriftMonitor")
  })
})
