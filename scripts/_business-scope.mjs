/**
 * The business an operator script works on, and the one way such a script
 * looks a row up by key. G45.
 *
 * Migration 00279 seeds the same `sequences.key` and `pipelines.key` values for
 * EVERY business, so "the sequence called sms_repermission" or "the assessment
 * board" names one row per business, not one row. A lookup by key alone either
 * throws (`.single()` on several rows) or, worse, finds some other business's
 * row. These scripts are run by a person against a named database, so the
 * business is theirs to name too: a required `--business <uuid>`, never a
 * default. A default here would be the platform's id, which is exactly the
 * "DJP is the platform" conflation the owner has ruled against.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A business id, or a thrown error that says what was wrong with it. */
export function parseBusinessId(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`--business needs a business id (a UUID), got ${value ? JSON.stringify(value) : "nothing"}`)
  }
  return value
}

/**
 * `--business <uuid>` from argv. Required, exactly once. For the scripts that
 * take no other flags; a script with its own parser calls `parseBusinessId`.
 */
export function readBusinessArg(argv) {
  const at = argv.indexOf("--business")
  if (at === -1) {
    throw new Error("--business <uuid> is required: every business has rows with the same keys (00279)")
  }
  if (argv.indexOf("--business", at + 1) !== -1) throw new Error("--business was given twice")
  return parseBusinessId(argv[at + 1])
}

/**
 * One row of `table` by `key`, inside ONE business. Null when that business
 * has none. Throws on a read error (PostgREST answers `{data:null, error}`
 * rather than throwing, and a script that read "not found" into a failure
 * would tell its operator the wrong thing).
 */
export async function findByKeyForBusiness(supabase, table, { businessId, key, select }) {
  parseBusinessId(businessId)
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq("business_id", businessId)
    .eq("key", key)
    .maybeSingle()
  if (error) throw new Error(`reading ${table} "${key}" for business ${businessId}: ${error.message}`)
  return data ?? null
}
