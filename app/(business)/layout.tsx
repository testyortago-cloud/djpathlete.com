import type { Metadata } from "next"

/**
 * THE BUSINESS'S OWN PAGES (G49): where a link in a business's sequence email
 * lands — /unsubscribe/<token> and /sms-consent/<token>. They used to sit in
 * app/(marketing), whose layout is this platform's navbar, footer and "Apply"
 * bar, so a coach's contact who unsubscribed landed on the platform's website.
 *
 * This layout adds nothing of the platform's. Each page wraps itself in
 * `BusinessFrame` with the identity of the business its token was signed for,
 * because only the page can read the token.
 *
 * The metadata undoes what the root layout would otherwise pass down, each of
 * which names the platform: the title template (and `absolute` on this
 * layout's own default, since a layout's title is still run through its
 * PARENT's template), the description, the Open Graph and Twitter blocks, and
 * the web-app manifest ("DJP"/the platform's name on a home screen). `null`
 * removes a parent's value. These are personal, tokenised links, so they are
 * kept out of search too.
 *
 * NOT covered, and not solvable here: the address bar shows the platform's
 * domain until coaches have their own hosts (`business_domains`), and the tab
 * icon stays the platform's (public/favicon.ico is fetched by the browser even
 * with no icon link, and naming the business's logo would mean resolving the
 * token in metadata, which the unsubscribe page must not do twice: it writes).
 */
export const metadata: Metadata = {
  title: { absolute: "Message settings", template: "%s" },
  description: null,
  openGraph: null,
  twitter: null,
  manifest: null,
  robots: { index: false, follow: false },
}

export default function BusinessPagesLayout({ children }: { children: React.ReactNode }) {
  return children
}
