import type { Metadata } from "next"
import { getActiveDocument } from "@/lib/db/legal-documents"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read the DJP Athlete Privacy Policy. Learn how we collect, use, and protect your personal information.",
  openGraph: {
    title: "Privacy Policy | DJP Athlete",
    description:
      "Read the DJP Athlete Privacy Policy. Learn how we protect your personal information.",
    type: "website",
  },
}

export default async function PrivacyPolicyPage() {
  const doc = await getActiveDocument("privacy_policy")

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Privacy Policy
          </h1>
          {doc && (
            <p className="mt-2 text-sm text-muted-foreground">
              Version {doc.version} &middot; Effective{" "}
              {new Date(doc.effective_date).toLocaleDateString("en-AU", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          )}
        </div>

        <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-heading prose-headings:tracking-tight prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4 prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground">
          {doc ? (
            <div dangerouslySetInnerHTML={{ __html: markdownToHtml(doc.content) }} />
          ) : (
            <p className="text-muted-foreground">
              Our Privacy Policy is being prepared. Please check back soon.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function markdownToHtml(markdown: string): string {
  return (
    markdown
      // Strip the leading h1 title (already rendered by the page header)
      .replace(/^# .+\n*/m, "")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/^(?!<[hulo])/gm, (match) => (match ? `<p>${match}` : match))
      .replace(/\n---\n/g, "<hr />")
  )
}
