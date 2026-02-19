import { NextResponse } from "next/server"
import { z } from "zod"
import { ghlTriggerWebhook } from "@/lib/ghl"

const webhookSchema = z.object({
  webhookUrl: z.string().url("Invalid webhook URL"),
  type: z.string().min(1, "Webhook type is required"),
}).passthrough()

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = webhookSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten() },
        { status: 400 }
      )
    }

    const { webhookUrl, ...data } = result.data

    const success = await ghlTriggerWebhook(webhookUrl, data as { type: string; [key: string]: unknown })

    if (!success) {
      return NextResponse.json(
        { error: "Failed to trigger webhook" },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
