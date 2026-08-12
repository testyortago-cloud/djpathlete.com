// lib/db/funnel-page-tree.ts — the visual builder's draft.
//
// Sibling of `funnel-builder.ts`, which owns the AI builder's draft and turn
// log. Both write `funnel_steps.doc_revision`, and they MUST agree about how:
// this file uses the same compare-and-swap `appendTurn` does, deliberately, so
// the two editors share one lock rather than each having their own idea of
// what "current" means.
//
//     .update({ doc_revision: expected + 1, page_tree })
//     .eq("id", stepId)
//     .eq("doc_revision", expected)     <-- the check IS the write
//
// Zero rows updated means somebody else moved first. That becomes a 409 so the
// client re-syncs instead of silently overwriting: a PageTree is a FULL
// SNAPSHOT, so a lost update is not a merge conflict, it is a page reverting to
// whatever the other tab had.

import { createServiceRoleClient } from "@/lib/supabase"
import { pageTreeSchema } from "@/lib/funnels/tree/schema"
import type { PageTree } from "@/lib/funnels/tree/types"

function getClient() {
  return createServiceRoleClient()
}

export interface PageTreeDraft {
  tree: PageTree | null
  revision: number
  /** The stored value did not parse. Never silently replaced with an empty page. */
  treeInvalid: boolean
}

export type SavePageTreeResult =
  | { ok: true; revision: number }
  /** Somebody else wrote first. The route turns this into a 409. */
  | { ok: false; reason: "stale_revision"; currentRevision: number }
  | { ok: false; reason: "not_found" }

async function readRevision(stepId: string): Promise<number | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_steps")
    .select("doc_revision")
    .eq("id", stepId)
    .maybeSingle()
  if (error) throw new Error(`readRevision: ${error.message}`)
  if (!data) return null
  return (data as { doc_revision: number }).doc_revision ?? 0
}

/**
 * Reads the draft tree. A stored document that no longer parses is reported as
 * `treeInvalid` rather than swapped for an empty page — silently handing the
 * editor a blank canvas would let the owner save over content they still had.
 */
export async function getPageTree(stepId: string): Promise<PageTreeDraft | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_steps")
    .select("page_tree, doc_revision")
    .eq("id", stepId)
    .maybeSingle()
  if (error) throw new Error(`getPageTree: ${error.message}`)
  if (!data) return null

  const row = data as { page_tree: unknown; doc_revision: number | null }
  const revision = row.doc_revision ?? 0

  if (row.page_tree === null || row.page_tree === undefined) {
    return { tree: null, revision, treeInvalid: false }
  }

  const parsed = pageTreeSchema.safeParse(row.page_tree)
  if (!parsed.success) return { tree: null, revision, treeInvalid: true }
  return { tree: parsed.data as PageTree, revision, treeInvalid: false }
}

/**
 * Validates before writing. The route validates too, and that is not
 * redundancy worth removing: this is the last gate before the column, and it is
 * the one a future non-route caller would also pass through.
 */
export async function savePageTree(
  stepId: string,
  tree: PageTree,
  expectedRevision: number,
): Promise<SavePageTreeResult> {
  pageTreeSchema.parse(tree)

  const supabase = getClient()
  const nextRevision = expectedRevision + 1

  const { data: swapped, error } = await supabase
    .from("funnel_steps")
    .update({
      page_tree: tree,
      doc_revision: nextRevision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stepId)
    .eq("doc_revision", expectedRevision)
    .select("doc_revision")
  if (error) throw new Error(`savePageTree: ${error.message}`)

  if (!swapped || swapped.length === 0) {
    const currentRevision = await readRevision(stepId)
    if (currentRevision === null) return { ok: false, reason: "not_found" }
    return { ok: false, reason: "stale_revision", currentRevision }
  }

  return { ok: true, revision: nextRevision }
}
