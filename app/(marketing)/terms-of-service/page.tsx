import type { Metadata } from "next"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Read the DJP Athlete Terms of Service. Understand your rights and responsibilities when using our athletic training platform.",
  openGraph: {
    title: "Terms of Service | DJP Athlete",
    description:
      "Read the DJP Athlete Terms of Service for our athletic training platform.",
    type: "website",
  },
}

export default async function TermsOfServicePage() {
  const doc = await getActiveDocument("terms_of_service")

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 pt-28 pb-16 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Terms of Service
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
            <div dangerouslySetInnerHTML={{ __html: renderLegalContent(doc.content) }} />
          ) : (
            <p className="text-muted-foreground">
              Our Terms of Service are being prepared. Please check back soon.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
