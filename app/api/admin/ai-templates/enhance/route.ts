import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { enhanceRequestSchema } from "@/lib/validators/prompt-template"
import { polishPrompt, generateTemplate } from "@/lib/ai/enhance-template"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = enhanceRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }

  const { mode, input, target_scope } = parsed.data

  try {
    if (mode === "polish") {
      const result = await polishPrompt(input, target_scope)
      return NextResponse.json({ mode, ...result })
    } else {
      const result = await generateTemplate(input, target_scope)
      return NextResponse.json({ mode, ...result })
    }
  } catch (err) {
    console.error("[ai-templates/enhance] error:", err)
    const message = err instanceof Error ? err.message : "Enhancement failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
