// app/api/admin/contacts/[id]/tags/route.ts — add and remove one contact's tags.
//
// Both verbs go through `withAudit` (lib/audit/with-audit.ts), which records
// success / denied / failure from the response status. The target is resolved
// from the route params by the callback form, because the contact id is in the
// path rather than the body — the same shape app/api/admin/clients/[id]/route.ts
// uses.
//
// THE TAG IS NORMALISED BY THE DAL, AND VALIDATED HERE WITH THE SAME FUNCTION.
// The rule itself lives in lib/contacts/tag-format.ts and is re-exported by the
// DAL, precisely so these cannot drift: a route that accepted the raw string
// while the DAL stored a normalised one would create a tag the operator could
// not then delete by typing what they can see on screen.
//
// DELETE CARRIES ITS TAG IN THE BODY, not the query string. A tag is
// operator-typed text that may contain spaces and punctuation, and a body
// avoids a second encoding rule to get wrong. DELETE with a body is legal and
// `request.json()` reads it the same way POST does.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { addTag, removeTag, normaliseTag, MAX_TAG_LENGTH } from "@/lib/db/contact-tags"
import { getContactById } from "@/lib/db/contact-detail"

/** Resolves `{ type, id }` for the audit row from the path. */
async function tagTarget(_req: Request, ctx: { params: Promise<Record<string, string>> }) {
  const { id } = (await ctx.params) as { id: string }
  return { type: "contact", id }
}

/**
 * Puts the tag itself on the audit row.
 *
 * WITHOUT THIS THE TRAIL IS UNUSABLE FOR ITS ONE PURPOSE. `withAudit` records
 * `metadata: {}` unless a resolver is supplied, and `tagTarget` carries only the
 * contact id — so `contact.tag_added` and `contact.tag_removed` rows would say
 * that somebody changed this contact's tags without saying WHICH, and a re-add
 * that hit the unique-constraint no-op would be byte-identical to one that
 * actually created a row.
 *
 * Read off the RESPONSE rather than the request body, so it records what the
 * write actually did (the normalised tag, and `created`) instead of what was
 * asked for. Failures resolve to `{}` — an unreadable body must never turn a
 * successful write into a 500.
 */
async function tagMetadata(_req: Request, res: Response): Promise<Record<string, unknown>> {
  try {
    const body = (await res.clone().json()) as { tag?: string; created?: boolean; removed?: boolean }
    return {
      tag: body.tag,
      ...(typeof body.created === "boolean" ? { created: body.created } : {}),
      ...(typeof body.removed === "boolean" ? { removed: body.removed } : {}),
    }
  } catch {
    return {}
  }
}

/**
 * Shared by both verbs: authenticate, confirm the contact exists, and pull a
 * usable tag out of the body.
 *
 * Returning the 404 for a contact that is not there — rather than writing the
 * tag anyway — matters because `contact_tags.contact_id` has a foreign key: an
 * insert for a missing contact would fail with a raw Postgres error and a 500,
 * which reads to the operator as "the app is broken" rather than "that contact
 * is gone".
 */
async function guard(
  request: Request,
  context: { params: Promise<Record<string, string>> },
): Promise<{ error: Response } | { contactId: string; tag: string; actorId: string }> {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return { error: NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 }) }
  }

  const { id } = (await context.params) as { id: string }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { error: NextResponse.json({ error: "Expected a JSON body." }, { status: 400 }) }
  }

  const raw = (body as { tag?: unknown } | null)?.tag
  const tag = normaliseTag(typeof raw === "string" ? raw : null)
  if (tag === null) {
    return {
      error: NextResponse.json({ error: `A tag must be between 1 and ${MAX_TAG_LENGTH} characters.` }, { status: 400 }),
    }
  }

  const contact = await getContactById(id)
  if (!contact) return { error: NextResponse.json({ error: "No such contact." }, { status: 404 }) }

  return { contactId: contact.id, tag, actorId: session.user.id }
}

export const POST = withAudit(
  { action: "contact.tag_added", category: "admin_write", target: tagTarget, metadata: tagMetadata },
  async (request, context) => {
    try {
      const checked = await guard(request, context)
      if ("error" in checked) return checked.error

      const result = await addTag({
        contactId: checked.contactId,
        tag: checked.tag,
        createdBy: checked.actorId,
      })

      // `created: false` means the contact already had it. That is a success,
      // not a conflict — the caller asked for the tag to be on the record and
      // it is. Reported so the audit metadata can tell the two apart.
      return NextResponse.json({ tag: result.tag, created: result.created })
    } catch (error) {
      console.error("Add contact tag error:", error)
      return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  { action: "contact.tag_removed", category: "admin_write", target: tagTarget, metadata: tagMetadata },
  async (request, context) => {
    try {
      const checked = await guard(request, context)
      if ("error" in checked) return checked.error

      const result = await removeTag({ contactId: checked.contactId, tag: checked.tag })
      return NextResponse.json({ tag: result.tag, removed: true })
    } catch (error) {
      console.error("Remove contact tag error:", error)
      return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 })
    }
  },
)
