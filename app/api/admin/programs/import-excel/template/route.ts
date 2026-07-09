import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { generateProgramTemplate } from "@/lib/excel-templates"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  const buf = await generateProgramTemplate()
  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="program-template.xlsx"',
    },
  })
}
