import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { generateProgramTemplate } from "@/lib/excel-templates"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const enabled = await getSetting<boolean>("feature_program_excel_import_enabled", true)
  if (!enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
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
