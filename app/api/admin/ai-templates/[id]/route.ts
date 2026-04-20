import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updatePromptTemplate, deletePromptTemplate, getPromptTemplateById } from "@/lib/db/prompt-templates"
import { promptTemplateUpdateSchema } from "@/lib/validators/prompt-template"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await getPromptTemplateById(id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const parsed = promptTemplateUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }

  const updated = await updatePromptTemplate(id, parsed.data)
  return NextResponse.json({ template: updated })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await getPromptTemplateById(id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await deletePromptTemplate(id)
  return NextResponse.json({ ok: true })
}
