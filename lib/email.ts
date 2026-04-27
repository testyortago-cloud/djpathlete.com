import { Resend } from "resend"
import { getPreferences } from "@/lib/db/notification-preferences"
import { getActiveSubscribers } from "@/lib/db/newsletter"
import type { Event, EventSignup } from "@/types/database"

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@darrenjpaul.com>"

/** CC all admin/business emails to Darren's main account */
const ADMIN_CC = "darren@darrenjpaul.com"

function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

/** Shared email wrapper with branded header + footer */
function emailLayout(content: string) {
  const baseUrl = getBaseUrl()
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>DJP Athlete</title>
  <link href="https://fonts.googleapis.com/css2?family=Lexend+Exa:wght@400;600;700&family=Lexend+Deca:wght@300;400;500&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#edece8; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#edece8;">
    <tr>
      <td align="center" style="padding:48px 16px;">

        <!-- Pre-header spacer with brand line -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:40px; border-bottom:2px solid #C49B7A;"></td>
                  <td style="padding:0 16px;">
                    <p style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:11px; color:#8a8680; letter-spacing:3px; text-transform:uppercase;">
                      DJP Athlete
                    </p>
                  </td>
                  <td style="width:40px; border-bottom:2px solid #C49B7A;"></td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Email container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:2px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.04), 0 20px 60px rgba(14,63,80,0.06);">

          <!-- ===== HEADER ===== -->
          <tr>
            <td style="background-color:#0E3F50; padding:0;">
              <!-- Top accent line -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="height:3px; background: linear-gradient(90deg, #C49B7A 0%, #d4b08e 50%, #C49B7A 100%);"></td>
                </tr>
              </table>
              <!-- Logo area -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:44px 48px 40px;">
                    <h1 style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:28px; font-weight:400; color:#ffffff; letter-spacing:8px; text-transform:uppercase;">
                      DJP ATHLETE
                    </h1>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
                      <tr>
                        <td style="width:24px; border-bottom:1px solid rgba(196,155,122,0.4);"></td>
                        <td style="padding:0 12px;">
                          <p style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; color:#C49B7A; letter-spacing:4px; text-transform:uppercase;">
                            Elite Performance
                          </p>
                        </td>
                        <td style="width:24px; border-bottom:1px solid rgba(196,155,122,0.4);"></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== BODY ===== -->
          <tr>
            <td style="padding:0;">
              ${content}
            </td>
          </tr>

          <!-- ===== FOOTER ===== -->
          <tr>
            <td style="padding:0;">
              <!-- Pre-footer accent -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 48px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="border-top:1px solid #e8e5e0;"></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Footer content -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:32px 48px 40px;">
                    <!-- Footer nav -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="padding-bottom:24px;">
                          <a href="${baseUrl}/programs" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Programs</a>
                          <span style="color:#d4cfc8; font-size:10px;">&bull;</span>
                          <a href="${baseUrl}/online" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Coaching</a>
                          <span style="color:#d4cfc8; font-size:10px;">&bull;</span>
                          <a href="${baseUrl}/blog" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Blog</a>
                          <span style="color:#d4cfc8; font-size:10px;">&bull;</span>
                          <a href="${baseUrl}/contact" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Contact</a>
                        </td>
                      </tr>
                    </table>
                    <!-- Copyright -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center">
                          <p style="margin:0 0 6px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#a09b94; letter-spacing:0.5px;">
                            &copy; ${new Date().getFullYear()} DJP Athlete. All rights reserved.
                          </p>
                          <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#b5b0a8;">
                            <a href="${baseUrl}/privacy-policy" style="color:#a09b94; text-decoration:underline;">Privacy Policy</a>
                            &nbsp;&middot;&nbsp;
                            <a href="${baseUrl}/terms-of-service" style="color:#a09b94; text-decoration:underline;">Terms of Service</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Email container -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`
}

/** Premium CTA button helper */
function ctaButton(href: string, label: string, variant: "primary" | "secondary" = "primary") {
  if (variant === "secondary") {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="border:2px solid #0E3F50; border-radius:2px;">
          <a href="${href}" target="_blank" style="display:inline-block; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; font-weight:600; color:#0E3F50; text-decoration:none; padding:12px 32px; letter-spacing:1.5px; text-transform:uppercase;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`
  }
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="background-color:#0E3F50; border-radius:2px;">
        <a href="${href}" target="_blank" style="display:inline-block; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; font-weight:600; color:#ffffff; text-decoration:none; padding:14px 40px; letter-spacing:1.5px; text-transform:uppercase;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

/** Premium info card helper */
function infoCard(rows: { label: string; value: string; valueColor?: string }[]) {
  const rowsHtml = rows
    .map(
      (r, i) => `
      <tr>
        <td style="padding:${i === 0 ? "0" : "16px"} 0 ${i === rows.length - 1 ? "0" : "16px"}; ${i > 0 ? "border-top:1px solid #eae7e2;" : ""}">
          <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
            ${r.label}
          </p>
          <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; font-weight:600; color:${r.valueColor ?? "#0E3F50"};">
            ${r.value}
          </p>
        </td>
      </tr>`,
    )
    .join("")

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
    <tr>
      <td style="padding:24px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${rowsHtml}
        </table>
      </td>
    </tr>
  </table>`
}

/** Section heading accent */
function sectionLabel(text: string) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
    <tr>
      <td style="border-bottom:2px solid #C49B7A; padding-bottom:8px;">
        <p style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; font-weight:400; color:#C49B7A; letter-spacing:3px; text-transform:uppercase;">
          ${text}
        </p>
      </td>
    </tr>
  </table>`
}

/** Fallback link block */
function fallbackLink(url: string) {
  return `
  <p style="margin:28px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#b5b0a8; line-height:1.6;">
    Button not working? Copy and paste this link:<br />
    <a href="${url}" style="color:#0E3F50; word-break:break-all; font-size:11px;">${url}</a>
  </p>`
}

/** Friendly nudge to whitelist us so future emails don't get junked. */
function junkFolderNote() {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
    <tr>
      <td style="background-color:#fbf8f3; border-left:3px solid #C49B7A; padding:14px 18px; border-radius:4px;">
        <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; color:#5c5750; line-height:1.6;">
          <strong style="color:#0E3F50;">Don't see our emails?</strong>
          Check your spam or junk folder and mark this message as <em>not spam</em> so future updates land in your inbox.
        </p>
      </td>
    </tr>
  </table>`
}

/** Hero banner for email types that have one */
function heroBanner(label: string, headline: string) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="background-color:#0E3F50; padding:36px 48px; text-align:center;">
        <p style="margin:0 0 10px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; color:#C49B7A; letter-spacing:4px; text-transform:uppercase;">
          ${label}
        </p>
        <h2 style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:24px; font-weight:400; color:#ffffff; line-height:1.3;">
          ${headline}
        </h2>
      </td>
    </tr>
  </table>`
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, firstName: string) {
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("Password Reset")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            We received a request to reset the password for your DJP Athlete account. Click the button below to set a new password.
          </p>

          ${ctaButton(resetUrl, "Reset My Password")}

          <!-- Security note -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:20px 24px;">
                <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Security Notice
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#5c5750; line-height:1.7;">
                  This link expires in <strong style="color:#0E3F50;">1 hour</strong>. If you didn&rsquo;t request this reset, you can safely ignore this email &mdash; your password will remain unchanged.
                </p>
              </td>
            </tr>
          </table>

          ${fallbackLink(resetUrl)}

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Reset your DJP Athlete password",
    html,
  })

  if (error) {
    console.error("Failed to send password reset email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendVerificationEmail(to: string, verifyUrl: string, firstName: string) {
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("Email Verification")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Thanks for signing up. Please verify your email address to activate your account.
          </p>

          ${ctaButton(verifyUrl, "Verify Email")}

          <p style="margin:32px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; color:#a09b94; line-height:1.7;">
            This link expires in <strong style="color:#5c5750;">24 hours</strong>. If you didn&rsquo;t create this account, you can safely ignore this email.
          </p>

          ${fallbackLink(verifyUrl)}

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Verify your DJP Athlete email",
    html,
  })

  if (error) {
    console.error("Failed to send verification email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendWelcomeEmail(to: string, firstName: string) {
  const baseUrl = getBaseUrl()

  const html = emailLayout(`
    ${heroBanner("Welcome to the Team", `You&rsquo;re in, ${firstName}.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 20px;">

          <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#333; line-height:1.8;">
            Your email is verified and your account is fully activated. Welcome to DJP Athlete &mdash; the platform built for athletes who are serious about performance.
          </p>

          <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Whether you&rsquo;re training in-person, coaching online, or coming back from injury &mdash; we&rsquo;ve got you covered.
          </p>

        </td>
      </tr>
    </table>

    <!-- Divider -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:12px 48px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="border-top:1px solid #eae7e2;"></td></tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- What's waiting -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:32px 48px 8px;">
          ${sectionLabel("What&rsquo;s Waiting For You")}
        </td>
      </tr>
    </table>

    <!-- Feature cards -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:0 48px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf9f7; border-radius:2px; border-left:3px solid #0E3F50;">
            <tr>
              <td style="padding:22px 28px;">
                <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; font-weight:600; color:#0E3F50;">
                  Personalized Programs
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#78736c; line-height:1.6;">
                  Training programs designed around your sport, position, and goals.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 48px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:22px 28px;">
                <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; font-weight:600; color:#0E3F50;">
                  Expert Coaching
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#78736c; line-height:1.6;">
                  Guidance from experienced coaches &mdash; in-person or online, wherever you train.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 48px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf9f7; border-radius:2px; border-left:3px solid #0E3F50;">
            <tr>
              <td style="padding:22px 28px;">
                <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; font-weight:600; color:#0E3F50;">
                  Performance Tracking
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#78736c; line-height:1.6;">
                  Data-driven assessments and benchmarks to track your progress.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Get started CTA -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:32px 48px 12px; text-align:center;">
          <p style="margin:0 0 24px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:16px; color:#333;">
            Ready to get started?
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td align="center" style="background-color:#0E3F50; border-radius:2px;">
                <a href="${baseUrl}/dashboard" target="_blank" style="display:inline-block; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; font-weight:600; color:#ffffff; text-decoration:none; padding:14px 48px; letter-spacing:1.5px; text-transform:uppercase;">
                  Go to My Dashboard
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Explore links -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:20px 48px 44px; text-align:center;">
          <p style="margin:0 0 16px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; color:#a09b94;">
            Or explore what we offer:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td style="padding:0 6px;">
                <a href="${baseUrl}/programs" style="display:inline-block; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; font-weight:600; color:#0E3F50; text-decoration:none; padding:10px 24px; border:2px solid #0E3F50; border-radius:2px; letter-spacing:1px; text-transform:uppercase;">
                  Programs
                </a>
              </td>
              <td style="padding:0 6px;">
                <a href="${baseUrl}/online" style="display:inline-block; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; font-weight:600; color:#0E3F50; text-decoration:none; padding:10px 24px; border:2px solid #0E3F50; border-radius:2px; letter-spacing:1px; text-transform:uppercase;">
                  Coaching
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Welcome to DJP Athlete — Let's Get Started",
    html,
  })

  if (error) {
    console.error("Failed to send welcome email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendAccountCreatedEmail(to: string, tempPassword: string, firstName: string, loginUrl: string) {
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("Account Created")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Your coach has created a DJP Athlete account for you. Use the temporary password below to log in and get started.
          </p>

          <!-- Password box -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0E3F50; border-radius:2px; margin-bottom:32px;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 6px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#C49B7A; text-transform:uppercase; letter-spacing:2px;">
                  Temporary Password
                </p>
                <p style="margin:0; font-family:'JetBrains Mono', 'Courier New', Courier, monospace; font-size:22px; font-weight:700; color:#ffffff; letter-spacing:3px;">
                  ${tempPassword}
                </p>
              </td>
            </tr>
          </table>

          ${ctaButton(loginUrl, "Log In to Your Account")}

          <!-- Security note -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:20px 24px;">
                <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Important
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#5c5750; line-height:1.7;">
                  Please change your password after your first login for security.
                </p>
              </td>
            </tr>
          </table>

          ${fallbackLink(loginUrl)}

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Your DJP Athlete account has been created",
    html,
  })

  if (error) {
    console.error("Failed to send account created email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendProgramReadyEmail(to: string, firstName: string, programName: string, clientUserId?: string) {
  // Check client's email notification preference
  if (clientUserId) {
    const prefs = await getPreferences(clientUserId)
    if (!prefs.email_notifications) return
  }

  const baseUrl = getBaseUrl()
  const programsUrl = `${baseUrl}/client/programs`

  const html = emailLayout(`
    ${heroBanner("Program Ready", "Your new training program is ready.")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Great news &mdash; your coach has created a personalized training program for you.
          </p>

          ${infoCard([{ label: "Program", value: programName }])}

          <p style="margin:28px 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Log in to your account to view the full program details and start training.
          </p>

          ${ctaButton(programsUrl, "View My Programs")}

          ${fallbackLink(programsUrl)}

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: `Your training program is ready: ${programName}`,
    html,
  })

  if (error) {
    console.error("Failed to send program ready email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendProgramAvailableForPurchaseEmail(
  to: string,
  firstName: string,
  programName: string,
  programId: string,
  clientUserId?: string,
) {
  // Check client's email notification preference
  if (clientUserId) {
    const prefs = await getPreferences(clientUserId)
    if (!prefs.email_notifications) return
  }

  const baseUrl = getBaseUrl()
  const programUrl = `${baseUrl}/client/programs/${programId}`

  const html = emailLayout(`
    ${heroBanner("New Program Available", "A new program is ready for you.")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Your coach has created a personalized training program just for you. Purchase it to get started.
          </p>

          ${infoCard([{ label: "Program", value: programName }])}

          <div style="height:32px;"></div>

          ${ctaButton(programUrl, "View &amp; Purchase")}

          ${fallbackLink(programUrl)}

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: `A new program is available for you: ${programName}`,
    html,
  })

  if (error) {
    console.error("Failed to send program available email:", error)
    // Non-blocking — don't throw
  }
}

/**
 * Notify the coach/admin that a client purchased a program.
 * Includes client details, program name, and whether the client has
 * completed their assessment questionnaire.
 */
export async function sendCoachPurchaseNotification({
  coachEmail,
  coachFirstName,
  coachUserId,
  clientName,
  clientEmail,
  clientId,
  programName,
  amountFormatted,
  hasQuestionnaire,
}: {
  coachEmail: string
  coachFirstName: string
  coachUserId?: string
  clientName: string
  clientEmail: string
  clientId: string
  programName: string
  amountFormatted: string
  hasQuestionnaire: boolean
}) {
  // Check admin's payment notification preference
  if (coachUserId) {
    const prefs = await getPreferences(coachUserId)
    if (!prefs.notify_payment_received) return
  }

  const baseUrl = getBaseUrl()
  const clientUrl = `${baseUrl}/admin/clients/${clientId}`
  const programsUrl = `${baseUrl}/admin/programs`

  const questionnaireBadge = hasQuestionnaire
    ? `<span style="display:inline-block; background-color:#dcfce7; color:#166534; font-size:11px; font-weight:600; padding:4px 14px; border-radius:2px; letter-spacing:0.5px;">Assessment Complete</span>`
    : `<span style="display:inline-block; background-color:#fef3c7; color:#92400e; font-size:11px; font-weight:600; padding:4px 14px; border-radius:2px; letter-spacing:0.5px;">Assessment Pending</span>`

  const nextStepText = hasQuestionnaire
    ? "Their assessment is complete — you can review their profile and generate a personalized AI program."
    : "They haven&rsquo;t completed their assessment yet. Once they do, you&rsquo;ll be able to generate a personalized program."

  const html = emailLayout(`
    ${heroBanner("New Purchase", `${clientName} just bought a program`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 24px;">
          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#333; line-height:1.8;">
            Hi ${coachFirstName}, a client just purchased a program. Here are the details:
          </p>

          <!-- Info card -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf9f7; border-radius:2px; border:1px solid #eae7e2;">
            <tr>
              <td style="padding:28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:0 0 16px;">
                      <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">Client</p>
                      <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; font-weight:600; color:#0E3F50;">${clientName}</p>
                      <p style="margin:2px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#78736c;">${clientEmail}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 0; border-top:1px solid #eae7e2;">
                      <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">Program</p>
                      <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; font-weight:600; color:#0E3F50;">${programName}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 0 0; border-top:1px solid #eae7e2;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="50%">
                            <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">Amount</p>
                            <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; font-weight:600; color:#166534;">${amountFormatted}</p>
                          </td>
                          <td width="50%">
                            <p style="margin:0 0 6px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">Assessment</p>
                            <p style="margin:0;">${questionnaireBadge}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Next steps -->
          <p style="margin:28px 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            ${nextStepText}
          </p>

          <!-- CTA buttons -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-right:12px;">
                ${ctaButton(clientUrl, "View Client")}
              </td>
              <td>
                ${ctaButton(programsUrl, "Generate Program", "secondary")}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: coachEmail,
    cc: coachEmail !== ADMIN_CC ? ADMIN_CC : undefined,
    subject: `New purchase: ${clientName} bought ${programName}`,
    html,
  })

  if (error) {
    console.error("Failed to send coach notification email:", error)
    // Non-blocking — don't throw
  }
}

/**
 * Notify the coach/admin that a client completed their assigned program.
 * Gated by the coach's `notify_program_completed` preference.
 */
export async function sendCoachProgramCompletedNotification({
  coachEmail,
  coachFirstName,
  coachUserId,
  clientName,
  clientId,
  programName,
}: {
  coachEmail: string
  coachFirstName: string
  coachUserId?: string
  clientName: string
  clientId: string
  programName: string
}) {
  // Check admin's program-completed notification preference
  if (coachUserId) {
    const prefs = await getPreferences(coachUserId)
    if (!prefs.notify_program_completed) return
  }

  const baseUrl = getBaseUrl()
  const clientUrl = `${baseUrl}/admin/clients/${clientId}`

  const html = emailLayout(`
    ${heroBanner("Program Completed", `${clientName} finished their program.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 24px;">
          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#333; line-height:1.8;">
            Hi ${coachFirstName}, great news &mdash; one of your athletes just completed their training program.
          </p>

          <!-- Info card -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf9f7; border-radius:2px; border:1px solid #eae7e2;">
            <tr>
              <td style="padding:28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:0 0 16px;">
                      <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">Client</p>
                      <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; font-weight:600; color:#0E3F50;">${clientName}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 0; border-top:1px solid #eae7e2;">
                      <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">Program</p>
                      <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; font-weight:600; color:#0E3F50;">${programName}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 0 0; border-top:1px solid #eae7e2;">
                      <p style="margin:0 0 6px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">Status</p>
                      <p style="margin:0;">
                        <span style="display:inline-block; background-color:#dcfce7; color:#166534; font-size:11px; font-weight:600; padding:4px 14px; border-radius:2px; letter-spacing:0.5px;">Completed</span>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Next steps -->
          <p style="margin:28px 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Now might be a good time to check in, review their progress, or assign a new program.
          </p>

          ${ctaButton(clientUrl, "View Client Profile")}
        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: coachEmail,
    cc: coachEmail !== ADMIN_CC ? ADMIN_CC : undefined,
    subject: `Program completed: ${clientName} finished ${programName}`,
    html,
  })

  if (error) {
    console.error("Failed to send program completed notification:", error)
    // Non-blocking — don't throw
  }
}

/**
 * Notify the coach/admin that a client submitted a form review request.
 * Gated by the coach's notification preferences.
 */
export async function sendFormReviewRequestEmail({
  coachEmail,
  coachFirstName,
  coachUserId,
  clientName,
  reviewTitle,
  reviewId,
}: {
  coachEmail: string
  coachFirstName: string
  coachUserId?: string
  clientName: string
  reviewTitle: string
  reviewId: string
}) {
  if (coachUserId) {
    const prefs = await getPreferences(coachUserId)
    if (!prefs.notify_new_client) return
  }

  const baseUrl = getBaseUrl()
  const reviewUrl = `${baseUrl}/admin/form-reviews/${reviewId}`

  const html = emailLayout(`
    ${heroBanner("Form Review Request", "New video submitted for review")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 48px;">
          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#333; line-height:1.8;">
            Hi ${coachFirstName}, ${clientName} just submitted a video for form review.
          </p>

          ${infoCard([
            { label: "Client", value: clientName },
            { label: "Review", value: reviewTitle },
          ])}

          <div style="height:28px;"></div>

          ${ctaButton(reviewUrl, "Review Video")}
        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: coachEmail,
    cc: coachEmail !== ADMIN_CC ? ADMIN_CC : undefined,
    subject: `Form review request: ${clientName} — ${reviewTitle}`,
    html,
  })

  if (error) {
    console.error("Failed to send form review request email:", error)
    // Non-blocking
  }
}

/**
 * Notify a client that their coach left feedback on their form review.
 * Gated by the client's email_notifications preference.
 */
export async function sendFormReviewFeedbackEmail({
  clientEmail,
  clientFirstName,
  clientUserId,
  reviewTitle,
  reviewId,
}: {
  clientEmail: string
  clientFirstName: string
  clientUserId?: string
  reviewTitle: string
  reviewId: string
}) {
  if (clientUserId) {
    const prefs = await getPreferences(clientUserId)
    if (!prefs.email_notifications) return
  }

  const baseUrl = getBaseUrl()
  const reviewUrl = `${baseUrl}/client/form-reviews/${reviewId}`

  const html = emailLayout(`
    ${heroBanner("Form Review Feedback", "Your coach left feedback.")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 48px;">
          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#333; line-height:1.8;">
            Hi ${clientFirstName}, your coach has reviewed your form video and left feedback.
          </p>

          ${infoCard([{ label: "Review", value: reviewTitle }])}

          <div style="height:28px;"></div>

          ${ctaButton(reviewUrl, "View Feedback")}

          ${fallbackLink(reviewUrl)}
        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: clientEmail,
    subject: `Your coach reviewed your form video: ${reviewTitle}`,
    html,
  })

  if (error) {
    console.error("Failed to send form review feedback email:", error)
    // Non-blocking
  }
}

/**
 * Notify a client that a performance assessment has been shared with them.
 */
export async function sendPerformanceAssessmentSharedEmail({
  clientEmail,
  clientFirstName,
  clientUserId,
  assessmentTitle,
  assessmentId,
}: {
  clientEmail: string
  clientFirstName: string
  clientUserId?: string
  assessmentTitle: string
  assessmentId: string
}) {
  if (clientUserId) {
    const prefs = await getPreferences(clientUserId)
    if (!prefs.email_notifications) return
  }

  const baseUrl = getBaseUrl()
  const assessmentUrl = `${baseUrl}/client/performance-assessments/${assessmentId}`

  const html = emailLayout(`
    ${heroBanner("Performance Assessment", "Your coach has shared an assessment with you")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 48px;">
          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#333; line-height:1.8;">
            Hi ${clientFirstName}, your coach has created a performance assessment for you. Upload your videos for each exercise and get feedback.
          </p>

          ${infoCard([{ label: "Assessment", value: assessmentTitle }])}

          <div style="height:28px;"></div>

          ${ctaButton(assessmentUrl, "View Assessment")}

          ${fallbackLink(assessmentUrl)}
        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: clientEmail,
    subject: `Performance Assessment: ${assessmentTitle}`,
    html,
  })

  if (error) {
    console.error("Failed to send performance assessment shared email:", error)
  }
}

/**
 * Notify the other party of a new message on a performance assessment exercise.
 */
export async function sendPerformanceAssessmentReplyEmail({
  recipientEmail,
  recipientFirstName,
  recipientUserId,
  senderName,
  exerciseName,
  assessmentTitle,
  assessmentId,
  isRecipientAdmin,
}: {
  recipientEmail: string
  recipientFirstName: string
  recipientUserId?: string
  senderName: string
  exerciseName: string
  assessmentTitle: string
  assessmentId: string
  isRecipientAdmin: boolean
}) {
  if (recipientUserId) {
    const prefs = await getPreferences(recipientUserId)
    if (isRecipientAdmin ? !prefs.notify_new_client : !prefs.email_notifications) return
  }

  const baseUrl = getBaseUrl()
  const assessmentUrl = isRecipientAdmin
    ? `${baseUrl}/admin/performance-assessments/${assessmentId}`
    : `${baseUrl}/client/performance-assessments/${assessmentId}`

  const html = emailLayout(`
    ${heroBanner("New Message", `${senderName} left feedback on an exercise`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 48px;">
          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#333; line-height:1.8;">
            Hi ${recipientFirstName}, ${senderName} left a message on the exercise "${exerciseName}" in the assessment "${assessmentTitle}".
          </p>

          ${infoCard([
            { label: "Assessment", value: assessmentTitle },
            { label: "Exercise", value: exerciseName },
          ])}

          <div style="height:28px;"></div>

          ${ctaButton(assessmentUrl, "View Assessment")}

          ${fallbackLink(assessmentUrl)}
        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: recipientEmail,
    subject: `New message on ${exerciseName} — ${assessmentTitle}`,
    html,
  })

  if (error) {
    console.error("Failed to send performance assessment reply email:", error)
  }
}

export async function sendReassessmentReminderEmail({
  to,
  firstName,
  programName,
  clientUserId,
}: {
  to: string
  firstName: string
  programName: string
  clientUserId?: string
}) {
  if (clientUserId) {
    const prefs = await getPreferences(clientUserId)
    if (!prefs.email_notifications) return
  }

  const baseUrl = getBaseUrl()
  const reassessmentUrl = `${baseUrl}/client/reassessment`

  const html = emailLayout(`
    ${heroBanner("Program Complete", "Time for your reassessment.")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            Congratulations, ${firstName}.
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            You&rsquo;ve completed your training program. Take a reassessment so your coach can build your next phase based on your progress.
          </p>

          ${infoCard([{ label: "Completed Program", value: programName }])}

          <p style="margin:28px 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            The reassessment takes just a few minutes and helps ensure your next program is tailored to where you are now.
          </p>

          ${ctaButton(reassessmentUrl, "Start Reassessment")}

          ${fallbackLink(reassessmentUrl)}

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: `You've completed ${programName} — time for your reassessment!`,
    html,
  })

  if (error) {
    console.error("Failed to send reassessment reminder email:", error)
  }
}

// ---------------------------------------------------------------------------
// Batch Email Sender (handles 10k+ subscribers)
// ---------------------------------------------------------------------------
// Uses Resend Batch API (up to 100 per call) with rate-limit delays.

const BATCH_SIZE = 100 // Resend batch API max
const BATCH_DELAY_MS = 1000 // 1 second between batches to respect rate limits

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendBatched(subscribers: { email: string }[], subject: string, html: string, label: string) {
  let sent = 0
  let failed = 0

  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE)

    try {
      const { data, error } = await resend.batch.send(
        batch.map((sub) => ({
          from: FROM_EMAIL,
          to: sub.email,
          subject,
          html,
        })),
      )

      if (error) {
        console.error(`[${label}] Batch ${i / BATCH_SIZE + 1} error:`, error)
        failed += batch.length
      } else {
        sent += data?.data?.length ?? batch.length
      }
    } catch (err) {
      console.error(`[${label}] Batch ${i / BATCH_SIZE + 1} exception:`, err)
      failed += batch.length
    }

    // Rate-limit delay between batches (skip after last batch)
    if (i + BATCH_SIZE < subscribers.length) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  console.log(`[${label}] Sent ${sent}/${subscribers.length} emails (${failed} failed)`)
  return { sent, failed }
}

// ---------------------------------------------------------------------------
// Blog Newsletter
// ---------------------------------------------------------------------------

interface BlogNewsletterData {
  title: string
  excerpt: string
  url: string
  category: string
  coverImageUrl?: string | null
}

export async function sendBlogNewsletterToAll(blog: BlogNewsletterData) {
  const baseUrl = getBaseUrl()
  const subscribers = await getActiveSubscribers()

  if (subscribers.length === 0) {
    console.log("[Newsletter] No active subscribers — skipping")
    return { sent: 0, failed: 0 }
  }

  const html = emailLayout(`
    <!-- Blog hero banner -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background-color:#0E3F50; padding:32px 48px; text-align:center;">
          <p style="margin:0 0 6px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; color:#C49B7A; letter-spacing:4px; text-transform:uppercase;">
            New on the Blog
          </p>
          <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; color:rgba(255,255,255,0.5); letter-spacing:1px;">
            ${blog.category}
          </p>
        </td>
      </tr>
    </table>

    ${
      blog.coverImageUrl
        ? `
    <!-- Cover image -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:0;">
          <img src="${blog.coverImageUrl}" alt="${blog.title}" width="600" style="display:block; width:100%; max-width:600px; height:auto;" />
        </td>
      </tr>
    </table>
    `
        : ""
    }

    <!-- Content -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 48px;">

          <h2 style="margin:0 0 20px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:24px; font-weight:400; color:#0E3F50; line-height:1.4;">
            ${blog.title}
          </h2>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            ${blog.excerpt}
          </p>

          ${ctaButton(blog.url, "Read the Full Post")}

          <!-- Divider -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px;">
            <tr>
              <td style="border-top:1px solid #eae7e2; padding-top:24px;">
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; color:#b5b0a8; line-height:1.6;">
                  You're receiving this because you subscribed to the DJP Athlete newsletter.
                  <a href="${baseUrl}/unsubscribe" style="color:#0E3F50; text-decoration:underline;">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  `)

  return sendBatched(subscribers, `New Post: ${blog.title}`, html, "Blog Newsletter")
}

// ---------------------------------------------------------------------------
// Standalone Newsletter
// ---------------------------------------------------------------------------

/** Builds the full branded HTML for a newsletter. Exported so the send API
 *  route can pre-build the HTML and pass it to the Cloud Function. */
export function buildNewsletterHtml(htmlContent: string): string {
  const baseUrl = getBaseUrl()
  return emailLayout(`
    <!-- Newsletter content -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:44px 48px 48px;">

          <div style="font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            ${htmlContent}
          </div>

          <!-- Divider -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px;">
            <tr>
              <td style="border-top:1px solid #eae7e2; padding-top:24px;">
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; color:#b5b0a8; line-height:1.6;">
                  You're receiving this because you subscribed to the DJP Athlete newsletter.
                  <a href="${baseUrl}/unsubscribe" style="color:#0E3F50; text-decoration:underline;">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  `)
}

interface StandaloneNewsletterData {
  subject: string
  previewText: string
  htmlContent: string
}

export async function sendStandaloneNewsletter(data: StandaloneNewsletterData) {
  const subscribers = await getActiveSubscribers()

  if (subscribers.length === 0) {
    console.log("[Newsletter] No active subscribers — skipping")
    return { sent: 0, failed: 0 }
  }

  const html = buildNewsletterHtml(data.htmlContent)

  return sendBatched(subscribers, data.subject, html, "Standalone Newsletter")
}

// ─── Admin notification emails ───

const INFO_EMAIL = "info@darrenjpaul.com"
const SALES_EMAIL = "sales@darrenjpaul.com"

export async function sendNewRegistrationEmail({
  firstName,
  lastName,
  email,
}: {
  firstName: string
  lastName: string
  email: string
}) {
  const baseUrl = getBaseUrl()

  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("New Client Registration")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            New Account Created
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            A new client has registered on the website.
          </p>

          ${infoCard([
            { label: "Name", value: `${firstName} ${lastName}` },
            { label: "Email", value: email },
          ])}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
            <tr>
              <td align="center">
                <a href="${baseUrl}/admin/clients" style="display:inline-block; padding:14px 32px; background-color:#0E3F50; color:#ffffff; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; font-weight:600; letter-spacing:2px; text-transform:uppercase; text-decoration:none; border-radius:2px;">
                  View Clients
                </a>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: INFO_EMAIL,
    cc: ADMIN_CC,
    subject: `[Registration] New Client — ${firstName} ${lastName}`,
    html,
  })

  if (error) {
    console.error("Failed to send new registration email:", error)
    throw new Error("Failed to send new registration email")
  }
}

export async function sendContactFormEmail({
  name,
  email,
  subject,
  message,
}: {
  name: string
  email: string
  subject: string
  message: string
}) {
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("New Contact Form Submission")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            New Message
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            You have received a new contact form submission from the website.
          </p>

          ${infoCard([
            { label: "Name", value: name },
            { label: "Email", value: email },
            { label: "Subject", value: subject },
          ])}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Message
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${message}
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:32px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; color:#a09b94;">
            Reply directly to <a href="mailto:${email}" style="color:#0E3F50; text-decoration:underline;">${email}</a>
          </p>

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: INFO_EMAIL,
    cc: ADMIN_CC,
    replyTo: email,
    subject: `[Contact] ${subject}`,
    html,
  })

  if (error) {
    console.error("Failed to send contact form email:", error)
    throw new Error("Failed to send contact form email")
  }
}

export async function sendInquiryEmail({
  name,
  email,
  phone,
  serviceLabel,
  sport,
  experience,
  goals,
  injuries,
  how_heard,
}: {
  name: string
  email: string
  phone?: string | null
  serviceLabel: string
  sport?: string | null
  experience?: string | null
  goals: string
  injuries?: string | null
  how_heard?: string | null
}) {
  const infoRows: { label: string; value: string }[] = [
    { label: "Name", value: name },
    { label: "Email", value: email },
    { label: "Service", value: serviceLabel },
  ]
  if (phone) infoRows.push({ label: "Phone", value: phone })
  if (sport) infoRows.push({ label: "Sport", value: sport })
  if (experience) infoRows.push({ label: "Experience", value: experience })
  if (how_heard) infoRows.push({ label: "How They Heard About Us", value: how_heard })

  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel(`New ${serviceLabel} Application`)}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            New Inquiry
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            A potential client has submitted an application for <strong style="color:#0E3F50;">${serviceLabel}</strong>.
          </p>

          ${infoCard(infoRows)}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Goals
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${goals}
                </p>
              </td>
            </tr>
          </table>

          ${
            injuries
              ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Injuries / Limitations
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${injuries}
                </p>
              </td>
            </tr>
          </table>
          `
              : ""
          }

          <p style="margin:32px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; color:#a09b94;">
            Reply directly to <a href="mailto:${email}" style="color:#0E3F50; text-decoration:underline;">${email}</a>
          </p>

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: SALES_EMAIL,
    cc: ADMIN_CC,
    replyTo: email,
    subject: `[Inquiry] New ${serviceLabel} Application — ${name}`,
    html,
  })

  if (error) {
    console.error("Failed to send inquiry email:", error)
    throw new Error("Failed to send inquiry email")
  }
}

const BOOKING_LINK = "https://api.leadconnectorhq.com/widget/booking/p9XdK6uz9EC3JKUhpzdA"

export async function sendContactAutoReply({ to, firstName }: { to: string; firstName: string }) {
  const html = emailLayout(`
    ${heroBanner("Thank You", `We&rsquo;ve received your message, ${firstName}.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          <p style="margin:0 0 24px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#5c5750; line-height:1.8;">
            Thanks for reaching out to DJP Athlete. We&rsquo;ve received your message and will get back to you within 24 hours.
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#5c5750; line-height:1.8;">
            Want to skip the wait? Book a call directly and let&rsquo;s talk about how we can help you perform at your best.
          </p>

          ${ctaButton(BOOKING_LINK, "Book a Call")}

          <p style="margin:36px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#a09b94; line-height:1.7;">
            Speak soon,<br />
            <strong style="color:#0E3F50;">Coach Darren</strong><br />
            DJP Athlete
          </p>

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Thanks for reaching out — DJP Athlete",
    html,
  })

  if (error) {
    console.error("Failed to send contact auto-reply:", error)
    throw new Error("Failed to send contact auto-reply")
  }
}

export async function sendInquiryAutoReply({
  to,
  firstName,
  serviceLabel,
}: {
  to: string
  firstName: string
  serviceLabel: string
}) {
  const html = emailLayout(`
    ${heroBanner("Application Received", `We&rsquo;re excited to hear from you, ${firstName}.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          <p style="margin:0 0 24px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#5c5750; line-height:1.8;">
            Thanks for applying for <strong style="color:#0E3F50;">${serviceLabel}</strong>. We&rsquo;ve received your application and our team will review it shortly.
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#5c5750; line-height:1.8;">
            The next step is to schedule a consultation call so we can learn more about your goals and create a plan tailored to you.
          </p>

          ${ctaButton(BOOKING_LINK, "Schedule Your Consultation")}

          <p style="margin:36px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#a09b94; line-height:1.7;">
            Looking forward to working with you,<br />
            <strong style="color:#0E3F50;">Coach Darren</strong><br />
            DJP Athlete
          </p>

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: `Your ${serviceLabel} application — DJP Athlete`,
    html,
  })

  if (error) {
    console.error("Failed to send inquiry auto-reply:", error)
    throw new Error("Failed to send inquiry auto-reply")
  }
}

/** Event context block — reused in all three event email templates */
function buildEventContextBlock(event: Event) {
  const start = new Date(event.start_date).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  const location = event.location_address ? `${event.location_name} — ${event.location_address}` : event.location_name
  return infoCard([
    { label: "Event", value: event.title },
    { label: "Date", value: start },
    { label: "Location", value: location },
  ])
}

export async function sendEventSignupReceivedEmail(signup: EventSignup, event: Event) {
  const eventUrl = `${getBaseUrl()}/${event.type === "clinic" ? "clinics" : "camps"}/${event.slug}`
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">
          ${sectionLabel("Signup received")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50;">
            Hi ${signup.parent_name},
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Thanks for registering ${signup.athlete_name}'s interest in ${event.title}. Darren reviews every
            signup and will respond within 48 hours.
          </p>

          ${buildEventContextBlock(event)}

          <div style="height:32px;"></div>

          ${ctaButton(eventUrl, "View event details")}

          ${fallbackLink(eventUrl)}

          ${junkFolderNote()}
        </td>
      </tr>
    </table>
  `)

  await resend.emails.send({
    from: FROM_EMAIL,
    to: signup.parent_email,
    subject: `We got your interest in ${event.title} — Darren J Paul`,
    html,
  })
}

export async function sendEventSignupConfirmedEmail(signup: EventSignup, event: Event) {
  const eventUrl = `${getBaseUrl()}/${event.type === "clinic" ? "clinics" : "camps"}/${event.slug}`
  const html = emailLayout(`
    ${heroBanner("You're confirmed", event.title)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:40px 48px 52px;">
          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50;">
            Hi ${signup.parent_name},
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            ${signup.athlete_name} is confirmed for ${event.title}. Here's what to keep on hand:
          </p>

          ${buildEventContextBlock(event)}

          <div style="height:28px;"></div>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Please arrive 10 minutes early. Bring water, appropriate footwear, and any gear your sport requires.
            If you have questions, reply to this email and Darren will get back to you.
          </p>

          ${ctaButton(eventUrl, "View event details")}

          ${fallbackLink(eventUrl)}

          ${junkFolderNote()}
        </td>
      </tr>
    </table>
  `)

  await resend.emails.send({
    from: FROM_EMAIL,
    to: signup.parent_email,
    subject: `You're confirmed for ${event.title}`,
    html,
  })
}

export async function sendEventSignupOverbookRefundEmail(signup: EventSignup, event: Event) {
  const eventUrl = `${getBaseUrl()}/${event.type === "clinic" ? "clinics" : "camps"}/${event.slug}`
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">
          ${sectionLabel("Refund issued")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50;">
            Hi ${signup.parent_name},
          </p>

          <p style="margin:0 0 20px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            We're sorry — ${event.title} filled up at the exact moment your payment was clearing.
            Two parents reached the last spot at the same time, and the system can only confirm one.
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            <strong>Your payment has been refunded in full.</strong> Refunds typically appear on your statement
            within 5–10 business days, depending on your bank.
          </p>

          ${buildEventContextBlock(event)}

          <div style="height:28px;"></div>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            If you'd like to be added to the waitlist or hear about future sessions, reply to this email
            and Darren will personally follow up.
          </p>

          ${ctaButton(eventUrl, "View other events")}

          ${fallbackLink(eventUrl)}

          ${junkFolderNote()}
        </td>
      </tr>
    </table>
  `)

  await resend.emails.send({
    from: FROM_EMAIL,
    to: signup.parent_email,
    subject: `Refunded — ${event.title} just filled up`,
    html,
  })
}

export async function sendAdminNewSignupEmail(signup: EventSignup, event: Event) {
  const adminUrl = `${getBaseUrl()}/admin/events/${event.id}`
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">
          ${sectionLabel("New signup")}

          <p style="margin:0 0 24px; font-family:'Lexend Exa', Georgia, serif; font-size:20px; color:#0E3F50;">
            ${signup.athlete_name} (age ${signup.athlete_age}) for ${event.title}
          </p>

          ${infoCard([
            { label: "Parent", value: `${signup.parent_name} · ${signup.parent_email}` },
            { label: "Phone", value: signup.parent_phone ?? "—" },
            { label: "Sport", value: signup.sport ?? "—" },
            { label: "Notes", value: signup.notes ?? "—" },
          ])}

          <div style="height:24px;"></div>

          ${infoCard([
            { label: "Event", value: event.title },
            { label: "Date", value: new Date(event.start_date).toLocaleString() },
            { label: "Location", value: event.location_name },
            { label: "Capacity", value: `${event.signup_count} / ${event.capacity} booked` },
          ])}

          <div style="height:32px;"></div>

          ${ctaButton(adminUrl, "Review in admin")}

          ${fallbackLink(adminUrl)}
        </td>
      </tr>
    </table>
  `)

  await resend.emails.send({
    from: FROM_EMAIL,
    to: ADMIN_CC,
    subject: `New signup: ${signup.athlete_name} for ${event.title}`,
    html,
  })
}
