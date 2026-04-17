export async function addContactToAudience(input: {
  email: string
  firstName: string | null
  lastName: string | null
  tag: string
}): Promise<string> {
  const key = process.env.RESEND_API_KEY
  const audienceId = process.env.RESEND_AUDIENCE_ID
  if (!key) throw new Error("RESEND_API_KEY not set")
  if (!audienceId) throw new Error("RESEND_AUDIENCE_ID not set")

  const res = await fetch(
    `https://api.resend.com/audiences/${audienceId}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        first_name: input.firstName ?? undefined,
        last_name: input.lastName ?? undefined,
        unsubscribed: false,
      }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`resend audience add failed (${res.status}): ${text}`)
  }
  const body = (await res.json()) as { id: string }
  // Resend v1 audiences API has no per-contact tags yet; the tag stays on the
  // shop_leads row instead. Kept in the interface for future compatibility.
  void input.tag
  return body.id
}
