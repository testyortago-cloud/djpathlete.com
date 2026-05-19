// Branded email template for Firebase Functions. Mirrors the design of
// lib/email.ts on the Next.js side — same DJP Athlete header, gold accent
// gradient, cream wrapper background, Lexend Exa headings, Lexend Deca body.
// Mirror is required because functions/ has rootDir: "src" and cannot
// import from lib/.

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.darrenjpaul.com"
  )
}

/** Shared email wrapper with branded header + footer. */
export function emailLayout(content: string): string {
  const baseUrl = getBaseUrl()
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>DJP Athlete</title>
  <link href="https://fonts.googleapis.com/css2?family=Lexend+Exa:wght@400;600;700&family=Lexend+Deca:wght@300;400;500&display=swap" rel="stylesheet" />
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
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#edece8;">
    <tr>
      <td align="center" style="padding:48px 16px;">

        <!-- Pre-header brand line -->
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

          <!-- Header -->
          <tr>
            <td style="background-color:#0E3F50; padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="height:3px; background: linear-gradient(90deg, #C49B7A 0%, #d4b08e 50%, #C49B7A 100%);"></td>
                </tr>
              </table>
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

          <!-- Body -->
          <tr>
            <td style="padding:0;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:0;">
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
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:32px 48px 40px;">
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
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Premium CTA button — solid dark-green primary style. */
export function ctaButton(href: string, label: string): string {
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

/** Section heading accent — gold underline + uppercase label. */
export function sectionLabel(text: string): string {
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

/** Premium info card with label/value rows. */
export function infoCard(rows: { label: string; value: string; valueColor?: string }[]): string {
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

/** Fallback link block under the CTA button. */
export function fallbackLink(url: string): string {
  return `
  <p style="margin:28px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#b5b0a8; line-height:1.6;">
    Button not working? Copy and paste this link:<br />
    <a href="${url}" style="color:#0E3F50; word-break:break-all; font-size:11px;">${url}</a>
  </p>`
}

/** Error block — used by failure emails. Cream-tinted card with red accent. */
export function errorBlock(error: string): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fdf6f4; border-radius:2px; border-left:3px solid #b04545;">
    <tr>
      <td style="padding:20px 24px;">
        <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
          Error
        </p>
        <pre style="margin:0; font-family:'JetBrains Mono', 'SF Mono', Consolas, monospace; font-size:12px; color:#5c5750; line-height:1.6; white-space:pre-wrap; word-break:break-word;">${error.slice(0, 1500)}</pre>
      </td>
    </tr>
  </table>`
}
