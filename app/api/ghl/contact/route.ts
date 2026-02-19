import { NextResponse } from "next/server"
import { z } from "zod"
import { ghlCreateContact } from "@/lib/ghl"

const contactSchema = z.object({
  email: z.string().email("Invalid email address"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = contactSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten() },
        { status: 400 }
      )
    }

    const contact = await ghlCreateContact(result.data)

    if (!contact) {
      return NextResponse.json(
        { error: "Failed to create or update contact" },
        { status: 502 }
      )
    }

    return NextResponse.json({ contact })
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
