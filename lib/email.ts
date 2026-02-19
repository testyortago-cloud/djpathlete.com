import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@djpathlete.com>"

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  firstName: string
) {
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Reset your DJP Athlete password",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="margin-bottom: 32px;">
          <h1 style="font-size: 20px; font-weight: 600; color: #0E3F50; margin: 0 0 8px;">
            DJP Athlete
          </h1>
        </div>

        <p style="font-size: 16px; color: #1a1a1a; margin: 0 0 16px;">
          Hi ${firstName},
        </p>

        <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 24px;">
          We received a request to reset your password. Click the button below to choose a new password. This link expires in 1 hour.
        </p>

        <div style="margin: 32px 0;">
          <a href="${resetUrl}" style="display: inline-block; background-color: #0E3F50; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 9999px;">
            Reset Password
          </a>
        </div>

        <p style="font-size: 13px; color: #999; line-height: 1.5; margin: 0 0 8px;">
          If you didn't request this, you can safely ignore this email. Your password will not change.
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

        <p style="font-size: 12px; color: #bbb; margin: 0;">
          DJP Athlete &mdash; Elite Performance Coaching
        </p>
      </div>
    `,
  })

  if (error) {
    console.error("Failed to send password reset email:", error)
    throw new Error("Failed to send email")
  }
}
