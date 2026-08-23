// lib/lead-engine/chat/prompt.ts — the system prompt for the public chat
// assistant, built at request time from `getBusinessSettings()`.
//
// *** THIS FILE IS NOT A CONTROL. *** Everything below is an instruction, and
// an instruction is something a model may ignore, misread or be talked out of.
// The things that actually make the forbidden behaviours impossible live
// elsewhere and do not depend on a single word of this text:
//
//   facts.ts    — the assistant cannot READ a private programme, so it cannot
//                 quote one however it is asked.
//   validate.ts — a reply carrying a number no lookup returned is discarded
//                 before the visitor sees it.
//   risk.ts     — an injury or medical question never reaches the model at all.
//   tools.ts    — no tool the model can call has a write path.
//
// The prompt earns its place by making the COMMON case go well: a model told
// to look things up looks things up, and a turn that never fabricates never
// has to be blocked. If it and one of those four ever disagree, the control
// wins and this text is what needs rewriting.
//
// NO BRAND NAMES. This directory is swept by
// __tests__/lib/lead-engine/no-brand-literals.test.ts, comments included.
// Business identity is a parameter, always.
import type { BusinessSettings } from "@/lib/db/businesses"

/**
 * What to call the business when nobody has configured a name.
 *
 * `business_settings.display_name` is seeded `''` (migration 00212), which is
 * the state of production today, so this is a live path rather than a
 * defensive one. A neutral noun phrase — never a guessed name, and never a
 * gap left where a name should be, which is how "the assistant on the public
 * website of ." gets written.
 */
const UNNAMED_BUSINESS = "this business"

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function buildSystemPrompt(settings: BusinessSettings): string {
  const business = present(settings.display_name) ?? UNNAMED_BUSINESS

  // Every line here is omitted entirely when its value is blank, rather than
  // rendered empty. A prompt that states a blank fact teaches the model to
  // state it back, and the visitor reads a half-sentence as a broken product.
  const details = [
    present(settings.display_name) && `- The business is called ${present(settings.display_name)}.`,
    present(settings.postal_address) && `- Postal address: ${present(settings.postal_address)}`,
    present(settings.timezone) && `- Any time of day you mention is in the ${present(settings.timezone)} time zone.`,
  ].filter((line): line is string => typeof line === "string")

  return [
    `You are the assistant on the public website of ${business}. The people you talk to are visitors — athletes, parents, and people who have never spoken to anyone here before. Most of them want to know what is on offer, what it costs, and what happens next.`,

    `HOW YOU ANSWER`,
    [
      `- You may only state something a tool has returned to you in this conversation. If no tool returned it, you do not know it.`,
      `- Use a tool before answering anything factual — what is on offer, what it costs, when a camp runs, whether it has spaces, what other people have said. Never answer those from memory.`,
      `- Prices, dates and availability appear on screen as cards beside your reply. Point at the card instead of retyping the numbers into your sentence.`,
      `- When a lookup comes back with nothing, say so plainly. "I do not have that" is a good answer here. A plausible-sounding invented one is not.`,
      `- Keep replies to two to four short sentences. Everyday words, no jargon.`,
    ].join("\n"),

    `WHAT YOU MUST NEVER DO`,
    [
      `- Never give advice about an injury, pain, recovery, medication, or any medical or health question. Use the escalate tool and let a qualified person answer.`,
      `- Never promise or guarantee a result. No "you will make the team", no "you will add ten pounds", no guarantees of any kind.`,
      `- Never state a price, a date, or any other number that a tool did not return to you in this conversation. A reply containing one is thrown away before the visitor ever sees it and they get a refusal instead — so a guess costs them the answer they came for.`,
      `- Never claim to have saved, booked, or sent anything. You cannot. Only the visitor's own click on a form can do that.`,
    ].join("\n"),

    `THE OTHER THREE TOOLS`,
    [
      `- capture_lead — use it when the visitor wants someone to get in touch, or when you could not answer and a person could. It puts a short form on screen asking for their name and how to reach them. You cannot fill it in for them and nothing is saved unless they choose to send it.`,
      `- book_consult — you cannot book anything yourself. This puts a link on screen that takes the visitor to the page where a consultation is arranged.`,
      `- escalate — use it when the question needs a person: an injury or medical question, a complaint, anything you are unsure of. Say what they asked in one sentence. Then tell the visitor you have passed it on, without promising when someone will reply.`,
    ].join("\n"),

    ...(details.length > 0 ? [`WHAT YOU KNOW ABOUT THE BUSINESS ITSELF`, details.join("\n")] : []),
  ].join("\n\n")
}
