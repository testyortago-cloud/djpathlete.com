/**
 * Free, credential-free deliverability check for a list of email addresses.
 *
 * Reads addresses from the database, a file, or stdin (a CSV column works too —
 * the first field containing an "@" is used), and classifies each one.
 *
 * Pick ONE of these — they are alternatives, not steps:
 *
 *   node scripts/check-email-deliverability.mjs --from-db .env.prod
 *   node scripts/check-email-deliverability.mjs my-list.csv
 *   pbpaste | node scripts/check-email-deliverability.mjs -
 *
 * Add --csv for machine-readable output. Run with no arguments for usage.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU — read before trusting a verdict.
 *
 * It resolves MX (falling back to A) for each distinct domain. That answers ONE
 * question authoritatively: can this DOMAIN receive mail at all? A domain with
 * neither record hard-bounces 100% of the time, and that is the `dead` verdict.
 *
 * It CANNOT tell you a specific mailbox exists. john.smith@gmail.com and
 * asdfgh@gmail.com are indistinguishable here — same MX, same verdict. Proving a
 * mailbox needs an SMTP `RCPT TO` handshake on port 25, which is
 *   (a) blocked outbound on most ISPs and cloud hosts, this machine included;
 *   (b) unreliable anyway — Gmail, Yahoo and Outlook accept every RCPT and only
 *       reject later, catch-all domains accept everything by design, and
 *       greylisting defers a first attempt from an unknown IP; and
 *   (c) a good way to get your own IP blocklisted for probing.
 * So it is not implemented, and a tool that claims otherwise is guessing.
 *
 * The only thing that truly proves "this won't bounce" is sending and reading
 * the bounce back. Use this to strip the guaranteed failures first, then send a
 * small batch and let the ESP tell you the rest.
 *
 * Exit code is 1 if any address is `dead` or `invalid` — the two verdicts that
 * bounce with certainty — so this can gate a send in CI. Every other verdict is
 * advisory and exits 0.
 */
import { readFileSync } from "node:fs"
import { Resolver } from "node:dns/promises"

const args = process.argv.slice(2)
const asCsv = args.includes("--csv")
const quiet = args.includes("--quiet")
const positional = args.filter((a) => !a.startsWith("--"))
const fromDbFlag = args.findIndex((a) => a === "--from-db")
const input = positional[0]

const USAGE = `Check a list of email addresses for domains that cannot receive mail.

  Check the live newsletter list (no export step):
    node scripts/check-email-deliverability.mjs --from-db .env.prod

  Check a file you already have (one address per line, or a CSV):
    node scripts/check-email-deliverability.mjs my-list.csv

  Check whatever is on the clipboard:
    pbpaste | node scripts/check-email-deliverability.mjs -

  Options:  --csv   machine-readable output      --quiet  no progress line

These are ALTERNATIVES — run one, not all three.`

if (fromDbFlag === -1 && !input) {
  console.error(USAGE)
  process.exit(1)
}

// --- known-bad domain lists -------------------------------------------------
// Deliberately short. These are judgement calls layered ON TOP of the DNS
// answer, never a substitute for it — see the typosquat note below.

const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "maildrop.cc",
  "getnada.com",
  "dispostable.com",
  "fakeinbox.com",
  "spamgourmet.com",
  "moakt.com",
  "emailondeck.com",
  "superrito.com",
  "sudomail.com",
  "teleworm.us",
  "jourrapide.com",
  "armyspy.com",
  "einrot.com",
  "cuvox.de",
  "dayrep.com",
  "fleckens.hu",
  "gustr.com",
  "rhyta.com",
  "muell.io",
  "obmen.us",
  "mail5u.info",
  "mail4u.lt",
])

// Misspellings of major providers that RESOLVE — a third party runs mail there
// and receives anything sent to them. These never bounce, so DNS alone reports
// them as fine; that is exactly why the list is hardcoded. Worse than a bounce:
// the message leaves your domain and lands with a stranger.
const TYPOSQUAT = new Set([
  "gamil.com",
  "gmial.com",
  "gmai.com",
  "gmil.com",
  "gnail.com",
  "gmaill.com",
  "iclould.com",
  "iclod.com",
  "icoud.com",
  "hotmial.com",
  "hotmil.com",
  "homail.com",
  "yahooo.com",
  "yhaoo.com",
  "outlok.com",
  "oulook.com",
])

const PLACEHOLDER = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "domain.com",
  "yourdomain.com",
  "email.com",
  "mydomain.com",
])

const ROLE = new Set([
  "info",
  "admin",
  "sales",
  "support",
  "contact",
  "office",
  "hello",
  "team",
  "marketing",
  "help",
  "noreply",
  "no-reply",
  "postmaster",
  "webmaster",
  "abuse",
  "service",
  "enquiries",
  "inquiries",
  "accounts",
  "billing",
  "hr",
  "careers",
  "jobs",
  "orders",
  "mail",
  "general",
  "reception",
  "customerservice",
])

// RFC 5322 in full is not worth implementing. This rejects what actually shows
// up in a real list: no @, two @, spaces, a bare TLD, a trailing dot.
const SYNTAX = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/

// --- input ------------------------------------------------------------------
/**
 * Reads active subscriber addresses straight from the database, so there is no
 * manual export step and no file of real addresses left lying around. Follows
 * the same env-file convention as the other scripts here
 * (e.g. `scripts/dump-legal-doc.mjs .env.prod …`) rather than reading process
 * env, because pointing this at the wrong database should require naming the
 * wrong file, not forgetting which shell you are in.
 *
 * Read-only: one SELECT, paged, no writes.
 */
async function readFromDb(envPath) {
  let envText
  try {
    envText = readFileSync(envPath, "utf8")
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(
        `No such env file: ${envPath}\n` + `Pass the file holding the Supabase credentials, e.g. --from-db .env.prod`,
      )
      process.exit(1)
    }
    throw err
  }
  const env = {}
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(`${envPath} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.`)
    process.exit(1)
  }
  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // PostgREST caps a single SELECT at ~1000 rows silently, so page — otherwise
  // a 5,894-row list reports on its first 1,000 and looks clean.
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("newsletter_subscribers")
      .select("email")
      .is("unsubscribed_at", null)
      .order("id", { ascending: true })
      .range(from, from + 999)
    if (error) {
      console.error(`database read failed: ${error.message}`)
      process.exit(1)
    }
    out.push(...data.map((r) => r.email))
    if (data.length < 1000) break
  }
  if (!quiet && !asCsv) {
    console.error(`Read ${out.length} active subscribers from ${new URL(url).hostname}\n`)
  }
  return out.join("\n")
}

function readInput(path) {
  try {
    return path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8")
  } catch (err) {
    // A raw ENOENT stack trace here is just noise — the useful information is
    // which path was tried and what to run instead.
    if (err.code === "ENOENT") {
      console.error(`No such file: ${path}\n\n${USAGE}`)
      process.exit(1)
    }
    if (err.code === "EISDIR") {
      console.error(`${path} is a directory, not a list of addresses.\n\n${USAGE}`)
      process.exit(1)
    }
    throw err
  }
}

const text = fromDbFlag !== -1 ? await readFromDb(args[fromDbFlag + 1] ?? ".env.prod") : readInput(input)
const seen = new Set()
const addresses = []
const lines = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"))

// Drop a CSV header, but ONLY the first line, and only when it names a column
// rather than being a failed address. Skipping every "@"-less line instead would
// silently swallow genuinely malformed entries like "not-an-email" — and a
// hygiene tool that quietly drops bad data is worse than one that flags it.
const first = lines[0]?.trim().toLowerCase()
if (first && !first.includes("@") && /(^|,)\s*"?e-?mail"?\s*(,|$)/.test(first)) lines.shift()

for (const line of lines) {
  const raw = line.trim()
  // Tolerate CSV: prefer the first comma-field containing an address; if no field
  // has one, fall back to the whole line so it is still reported as invalid.
  const field = raw.includes(",") ? (raw.split(",").find((f) => f.includes("@")) ?? raw) : raw
  const email = field
    .trim()
    .replace(/^["'<]|["'>]$/g, "")
    .toLowerCase()
  if (!email) continue
  if (seen.has(email)) continue // report each address once
  seen.add(email)
  addresses.push(email)
}

if (addresses.length === 0) {
  console.error("no addresses found in input")
  process.exit(1)
}

// --- DNS --------------------------------------------------------------------
// Public resolvers, so a captive/ISP resolver that NXDOMAIN-hijacks (returning
// an ad server's A record for every miss) cannot turn a dead domain into a
// live-looking one. That hijack is common enough to defeat this whole check.
const resolver = new Resolver({ timeout: 5000, tries: 2 })
resolver.setServers(["1.1.1.1", "8.8.8.8"])

// A SECOND, independent resolver, consulted only when the first will not answer.
// This is not redundancy for its own sake: some real zones deliberately refuse
// the big public resolvers. `army.mil` and `us.af.mil` SERVFAIL on both 1.1.1.1
// and 8.8.8.8 while resolving perfectly on Quad9 (`pri-nipr.eemsg.mail.mil`) —
// so a single-resolver run reports live US military mailboxes as unresolvable,
// and, before the authoritative-vs-transient split above, as `dead`.
const fallbackResolver = new Resolver({ timeout: 5000, tries: 2 })
fallbackResolver.setServers(["9.9.9.9", "208.67.222.222"])

const domains = [...new Set(addresses.map((e) => e.split("@")[1]))]
const dns = new Map()

/**
 * A `dead` verdict means "delete this subscriber", so it must rest on POSITIVE
 * evidence that the domain does not exist — never on the mere absence of an
 * answer. Node reports these separately and they mean different things:
 *
 *   ENOTFOUND  NXDOMAIN — authoritative: the domain does not exist.
 *   ENODATA    the domain exists but publishes no record of that type.
 *   ETIMEOUT / ESERVFAIL / ECONNREFUSED / EREFUSED — we did not get an answer.
 *
 * An earlier version caught all of these with a bare `catch {}` and returned
 * `dead`. Across three full runs of the 726-domain list that made the DEAD count
 * flap 49 / 50 / 49 — a handful of live domains timed out and were reported as
 * guaranteed bounces. On a tool whose output drives deletions that is the worst
 * possible failure: it silently recommends removing real subscribers because the
 * network hiccuped. Anything we cannot resolve is now `unknown`, which is
 * reported separately and never counted as a bounce.
 */
const AUTHORITATIVE_MISS = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND", "NODATA"])

async function lookup(method, domain) {
  // Retry only the transient codes, and only a couple of times — a real
  // NXDOMAIN is final and retrying it just slows the run down. Then fall back
  // to the second resolver before conceding that we do not know.
  let lastCode = "EUNKNOWN"
  for (const r of [resolver, fallbackResolver]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { ok: true, value: await r[method](domain) }
      } catch (err) {
        lastCode = err.code ?? "EUNKNOWN"
        // An authoritative "does not exist" is the same answer from any
        // resolver, so stop immediately rather than asking the other one.
        if (AUTHORITATIVE_MISS.has(lastCode)) {
          return { ok: false, authoritative: true, code: lastCode }
        }
        await new Promise((res) => setTimeout(res, 150 * (attempt + 1)))
      }
    }
  }
  return { ok: false, authoritative: false, code: lastCode }
}

async function resolveDomain(domain) {
  const mx = await lookup("resolveMx", domain)
  if (mx.ok) {
    // A single "." exchange is RFC 7505's explicit "this domain sends no mail".
    const usable = mx.value.filter((r) => r.exchange && r.exchange !== ".")
    if (usable.length > 0) {
      usable.sort((a, b) => a.priority - b.priority)
      return { status: "mx", detail: usable[0].exchange }
    }
    return { status: "null_mx", detail: "RFC 7505 null MX — domain refuses mail" }
  }
  if (!mx.authoritative) {
    return { status: "unknown", detail: `MX lookup did not answer (${mx.code})` }
  }

  // No MX, authoritatively. A domain may still accept mail on its A record
  // (RFC 5321 §5.1), so the A answer decides between `a_only` and `dead`.
  const a = await lookup("resolve4", domain)
  if (a.ok && a.value.length > 0) return { status: "a_only", detail: `no MX; A ${a.value[0]}` }
  if (!a.authoritative) {
    return { status: "unknown", detail: `no MX; A lookup did not answer (${a.code})` }
  }
  return { status: "dead", detail: "no MX and no A record" }
}

// Bounded concurrency: enough to be fast, low enough not to look like a flood.
const CONCURRENCY = 20
let cursor = 0
async function worker() {
  while (cursor < domains.length) {
    const domain = domains[cursor++]
    dns.set(domain, await resolveDomain(domain))
    if (!quiet && !asCsv && dns.size % 25 === 0) {
      process.stderr.write(`\r  resolving… ${dns.size}/${domains.length}`)
    }
  }
}
if (!quiet && !asCsv) process.stderr.write(`Resolving ${domains.length} domains…`)
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domains.length) }, worker))
if (!quiet && !asCsv) process.stderr.write(`\r  resolved ${domains.length} domains          \n\n`)

// --- verdicts ---------------------------------------------------------------
// Ordered worst-first: the first matching rule wins, so a disposable address on
// a dead domain reports as `dead` (the more actionable fact).
function classify(email) {
  const [local, domain] = email.split("@")
  if (!SYNTAX.test(email)) return ["invalid", "not a valid address"]

  const d = dns.get(domain)
  if (d.status === "dead") return ["dead", d.detail]
  if (d.status === "null_mx") return ["dead", d.detail]
  // Checked before the curated lists: not knowing whether a domain resolves is a
  // fact about this run, and it should not be dressed up as a verdict about the
  // address just because the domain happens to be on a list.
  if (d.status === "unknown") return ["unknown", d.detail]
  if (PLACEHOLDER.has(domain)) return ["placeholder", "placeholder domain"]
  if (TYPOSQUAT.has(domain)) return ["typosquat", `misspelt provider, live MX (${d.detail})`]
  if (DISPOSABLE.has(domain)) return ["disposable", "throwaway mailbox service"]
  if (d.status === "a_only") return ["risky", d.detail]
  if (ROLE.has(local)) return ["role", "shared inbox, not a person"]
  return ["ok", d.detail]
}

const results = addresses.map((email) => {
  const [verdict, reason] = classify(email)
  // A malformed address may have no domain part at all — print an empty cell
  // rather than the string "undefined", which would look like a real domain.
  return { email, domain: email.split("@")[1] ?? "", verdict, reason }
})

// --- output -----------------------------------------------------------------
const ORDER = ["dead", "invalid", "typosquat", "risky", "disposable", "placeholder", "unknown", "role", "ok"]
const ADVICE = {
  dead: "WILL BOUNCE — remove before sending",
  invalid: "WILL BOUNCE — malformed, remove",
  typosquat: "will NOT bounce; a stranger receives it — remove",
  risky: "probably bounces (no MX, A-record fallback only)",
  disposable: "deliverable but worthless — remove",
  placeholder: "test data — remove",
  unknown: "DNS did not answer — re-run before deciding; do NOT delete on this",
  role: "deliverable; shared inbox, complains more — your call",
  ok: "domain can receive mail (mailbox itself unproven)",
}

if (asCsv) {
  console.log("email,domain,verdict,reason")
  for (const v of ORDER) {
    for (const r of results.filter((x) => x.verdict === v)) {
      // Quote every field: a malformed entry can itself contain a comma (the
      // whole "not-an-email,Carl" line is kept so it can be found in the source),
      // which would otherwise emit a row with the wrong column count.
      const q = (s) => `"${String(s).replace(/"/g, '""')}"`
      console.log([r.email, r.domain, r.verdict, r.reason].map(q).join(","))
    }
  }
} else {
  for (const v of ORDER) {
    const rows = results.filter((r) => r.verdict === v)
    if (rows.length === 0) continue
    console.log(`${v.toUpperCase()} — ${rows.length} — ${ADVICE[v]}`)
    if (v !== "ok") for (const r of rows) console.log(`    ${r.email}  (${r.reason})`)
    console.log("")
  }
  const bad = results.filter((r) => ["dead", "invalid"].includes(r.verdict)).length
  const strip = results.filter((r) =>
    ["dead", "invalid", "typosquat", "risky", "disposable", "placeholder"].includes(r.verdict),
  ).length
  const unresolved = results.filter((r) => r.verdict === "unknown").length
  console.log(`${results.length} addresses, ${domains.length} domains.`)
  console.log(`${bad} will definitely bounce. ${strip} worth removing before a send.`)
  if (unresolved > 0) {
    console.log(
      `${unresolved} could not be resolved this run — re-run to settle them. ` + `They are NOT counted above.`,
    )
  }
  console.log(
    "\nA clean result here is NOT proof of delivery — it means the domain accepts mail.\n" +
      "The mailbox is only proven by sending. Strip these, then send a small batch\n" +
      "and read the bounces.",
  )
}

process.exit(results.some((r) => r.verdict === "dead" || r.verdict === "invalid") ? 1 : 0)
