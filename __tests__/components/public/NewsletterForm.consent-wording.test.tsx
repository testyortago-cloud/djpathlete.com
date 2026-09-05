// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { NewsletterForm } from "@/components/public/NewsletterForm"
import { renderNewsletterConsentWording } from "@/lib/lead-engine/newsletter-consent-wording"

// Fidelity check: app/api/newsletter/route.ts re-renders
// renderNewsletterConsentWording(business_settings.display_name) to file as
// contact_consents.wording_shown whenever this checkbox was the thing that
// was actually ticked (consent_context: "checkbox"). That row is only
// truthful evidence of what the visitor saw if the template really does
// reproduce this checkbox's visible text. If NewsletterForm.tsx's copy
// changes without updating the template (or vice versa), this test must
// fail — the recorded evidence would otherwise rot silently.
//
// "DJP Athlete" is not a re-guess of the business name: it is the literal,
// hard-coded string components/public/NewsletterForm.tsx shows today (it
// does not yet read a configured display name). If that component starts
// reading one instead, this test's expected name must change to match what
// it actually renders.
describe("NewsletterForm — consent checkbox text matches the recorded template", () => {
  it('the checkbox\'s visible text equals renderNewsletterConsentWording("DJP Athlete")', () => {
    render(<NewsletterForm />)

    const expectedText = renderNewsletterConsentWording("DJP Athlete")
    expect(screen.getByText(expectedText)).toBeInTheDocument()
  })
})
