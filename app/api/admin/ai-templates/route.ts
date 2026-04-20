import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPromptTemplates, createPromptTemplate } from "@/lib/db/prompt-templates"
import { promptTemplateCreateSchema } from "@/lib/validators/prompt-template"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const rawScope = url.searchParams.get("scope")
  const scope = rawScope === "week" || rawScope === "day" ? rawScope : undefined

  const templates = await listPromptTemplates(scope ? { scope } : undefined)
  return NextResponse.json({ templates })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = promptTemplateCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }

  const created = await createPromptTemplate({
    ...parsed.data,
    created_by: session.user.id,
  })
  return NextResponse.json({ template: created }, { status: 201 })
}
