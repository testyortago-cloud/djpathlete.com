import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getPayments } from "@/lib/db/payments"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payments = await getPayments(session.user.id)
    return NextResponse.json(payments)
  } catch (error) {
    console.error("Client payments fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 })
  }
}
