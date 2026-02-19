import { NextResponse } from "next/server"
import { contactFormSchema } from "@/lib/validators/contact"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = contactFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, email, subject, message } = result.data

    // TODO: Integrate with email service (e.g., Resend, SendGrid) or store in database
    // For now, log the submission and return success
    console.log("Contact form submission:", { name, email, subject, message })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
