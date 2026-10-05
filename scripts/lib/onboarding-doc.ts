// scripts/lib/onboarding-doc.ts — the pre-visit onboarding form.
//
// Rebuilt from the GHL page at athletequiz.darrenjpaul.com/onboarding: the same
// fifteen questions in the same order, with the same dropdown choices.
//
// THE WAIVER IS NOT COPIED. GHL pastes its own waiver text into the page. Here
// the tick carries `role: "waiver_accepted"`, so the form shows the business's
// ACTIVE liability waiver from /admin/legal above it, and the submission files
// which document was shown. One waiver, edited in one place, and the evidence
// names the version the visitor actually agreed to.
//
// Checked by `__tests__/scripts/funnel-page-docs.test.ts`.

import type { SectionDoc } from "@/lib/funnels/sections/registry"

const YES_NO = ["Yes", "No"]

export function buildOnboardingDoc(input: { businessName: string }): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "intake",
        kind: "form",
        // `stacked`, on a muted band: it is centred whatever the align knob says.
        // `boxed` sits against the left edge unless `align: "center"`, and that
        // also centres every label and the waiver text on a fifteen-field form.
        variant: "stacked",
        style: { pad: "roomy", tone: "muted" },
        props: {
          heading: "Before your first session",
          sub: "Please complete this short form before your first in-person session. It helps me understand your background, injury history and goals, so we can make the most of our time together.",
          formKey: "pre-visit",
          // Booked clients, not leads: file the contact, start no new-lead nurture.
          skipFollowUp: true,
          submitLabel: "Submit & confirm pre-visit details",
          successMode: "message",
          successMessage: "Thank you. Your details are in, and I'll read them before your first session.",
          fields: [
            { name: "first_name", label: "First name", type: "text" },
            { name: "last_name", label: "Last name", type: "text" },
            { name: "phone", label: "Phone", type: "tel", required: true },
            { name: "email", label: "Email", type: "email", required: true },
            { name: "age", label: "Age", type: "text", required: true },
            {
              name: "currently_training",
              label: "Are you currently training?",
              type: "select",
              required: true,
              options: YES_NO,
            },
            {
              name: "current_training",
              label: "If yes, what does your current training look like? (gym, sport, frequency, intensity)",
              type: "textarea",
            },
            {
              name: "training_history",
              label: "How long have you been training consistently?",
              type: "select",
              required: true,
              options: ["New / just starting", "Less than 6 months", "6–12 months", "1–3 years", "3+ years"],
            },
            {
              name: "injury_or_pain",
              label: "Do you currently have any injuries or pain?",
              type: "select",
              options: YES_NO,
            },
            {
              name: "injury_details",
              label: "If yes, please describe the injury or pain (location, how long, diagnosis if any)",
              type: "textarea",
            },
            {
              name: "previous_injuries",
              label: "Have you had any previous injuries or surgeries?",
              type: "textarea",
              required: true,
            },
            {
              name: "seeing_professional",
              label: "Are you currently seeing a physio, doctor, or health professional?",
              type: "select",
              required: true,
              options: YES_NO,
            },
            {
              name: "goals",
              label: "Please briefly explain what you want to achieve",
              type: "textarea",
              required: true,
            },
            {
              name: "medical_conditions",
              label: "Do you have any medical conditions that may affect training? (e.g. heart conditions, asthma)",
              type: "textarea",
              required: true,
            },
            {
              name: "waiver",
              label: "I have read and agree to the liability waiver above.",
              type: "checkbox",
              required: true,
              role: "waiver_accepted",
            },
          ],
        },
      },
      {
        id: "foot",
        kind: "footer",
        variant: "simple",
        style: {},
        props: {
          businessName: input.businessName,
          lines: [],
          links: [],
          legal: "All rights reserved.",
        },
      },
    ],
  }
}
