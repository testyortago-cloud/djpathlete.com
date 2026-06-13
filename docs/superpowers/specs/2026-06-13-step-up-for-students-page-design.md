# Step Up For Students Landing Page — Design Spec

**Date:** 2026-06-13
**Type:** Feature build-out (new marketing page)
**Source:** Client (Darren) generated a standalone HTML mockup (`step-up-for-students.html`) via Claude and recorded a voice walkthrough of changes he wants. This spec ports that page into the live Next.js app, rebranded to the DJP design system, with his requested content changes applied as smart defaults.

> **Process note:** Brainstormed interactively (deliverable / theme / content-handling confirmed by the developer), then the developer said "I'll sleep now." Per the user's global autonomous-mode instruction, the interactive design-approval and spec-review gates are bypassed; decisions on every open item are made here, documented, and surfaced in the **Review Checklist** for Darren to confirm on return. Nothing is pushed/deployed and no prod-DB writes are made.

---

## 1. Goal & Scope

Build a dedicated, indexable marketing landing page at **`/step-up-for-students`** that explains Darren's status as an approved Step Up For Students (SUFS) scholarship provider and converts eligible Florida families into consultation leads.

**In scope**
- New route `app/(marketing)/step-up-for-students/page.tsx` (server component) + `loading.tsx`.
- A dedicated lead-capture form component that posts through the **existing** `/api/inquiry` pipeline (no new API, no DB/schema migration).
- SEO: page metadata, `Service` + `BreadcrumbSchema` + `FAQPage` JSON-LD, sitemap entry, a footer link.
- Rebrand from the mockup's black/gold palette to the DJP brand (Green Azure + Gray Orange, Lexend fonts, light surfaces), reusing the established marketing-page section/card patterns (`FadeIn`, accent eyebrows, `rounded-2xl` cards, `bg-surface` alternation).

**Out of scope (deferred / flagged)**
- Moving the FAQ content into the CMS `faqs` table (would require a prod-DB write). FAQs are rendered statically in-page for v1, still emitting `FAQPage` JSON-LD. Can be migrated to the CMS later.
- Adding the page to the global top nav (`SiteNavbar`) — visibility decision left to Darren; we add a footer link only.
- Any EMA/billing integration. The page is informational + lead-gen; the actual EMA process is handled offline by Darren.

---

## 2. Reuse / Integration Points (existing code)

- **Layout:** `app/(marketing)/layout.tsx` already wraps every marketing route in `SiteNavbar` + `Footer` + `StickyApplyCTA`. The page renders only its own `<section>`s — no custom nav/footer (the mockup's custom nav/footer are dropped).
- **Animation:** `components/shared/FadeIn`.
- **SEO:** `components/shared/JsonLd`, `components/shared/BreadcrumbSchema`, `lib/seo/build-faq-page-schema` (`buildFaqPageSchema`, needs ≥3 Q&As — we have 8).
- **Lead pipeline:** `POST /api/inquiry` → `inquiryFormSchema` (`lib/validators/inquiry.ts`). It creates a `lead` user, notifies admins (the `goals` text is shown to the coach verbatim), emails sales + auto-reply, and syncs to GHL. On success the existing pattern routes to `/application-received`.
- **Service enum:** `SERVICE_TYPES = ["in_person","online","assessment","clinic","camp"]`. The SUFS form maps its friendlier service labels onto this enum; the true selection is also written into the `goals` text so nothing is lost.
- **Sitemap:** `app/sitemap.ts` static-pages array.
- **Footer links:** `FOOTER_SECTIONS` in `lib/constants.ts`.

---

## 3. Page Structure (sections, in order)

1. **Approved-provider banner** — slim accent strip (replaces the mockup's global notice banner): "DJP Athlete is an approved Step Up For Students provider — eligible families can direct scholarship funds toward sports performance training."
2. **Hero** — badge ("Official Step Up For Students Approved Provider"), H1 ("Use Your Step Up Scholarship for *Sports Performance* Training"), sub-paragraph, two CTAs (`Book a Free Consultation` → `#apply`, `See How It Works` → `#how-it-works`), and a 4-stat proof row (20+ yrs / 500+ athletes / PhD CSCS·NASM / 4 scholarships accepted).
3. **What is Step Up For Students** — explainer paragraph + 4 info cards (ESA model, P.E. category covers sports training, quarterly disbursements, already-approved/EMA). *The hard "$8,000–$10,000+/yr" figure is removed from these cards* (see §4).
4. **Eligibility** — the 4 scholarships (FES-EO, FES-UA, PEP, FTC): name + who-it's-for + coverage checkmark. **Dollar amounts removed per Darren.** A single soft **funding note** callout sits at the bottom of this section (not a sparse standalone section).
5. **Proof strip** — Wayde van Niekerk quote + rating stats (5.0 / 49 reviews / 15+ sports).
6. **What Your Scholarship Covers** — 6 service cards (Assessment, In-Person Performance Training, Online Performance Program, Agility Clinic, Performance Camps, Homeschool PE), each with a "PE Eligible" tag. Wording updated from "coaching" → "training / program" per Darren (see §4).
7. **Who It's For** — 6 audience cards (homeschool, youth, private-school, unique-abilities, performance-focused, return-to-sport).
8. **Packages** — 4 scholarship-ready packages (see §4 for the reframed set).
9. **How It Works** — 4 numbered steps (confirm eligibility → free consult → select package / EMA billing → training begins, documented).
10. **FAQ** — 8 Q&As (static, card style, with `FAQPage` JSON-LD).
11. **Apply / Contact** — `StepUpInquiryForm` (scholarship-aware) with the consultation pitch; `id="apply"`.

Icons: use Lucide (matching the rest of the site) instead of the emoji in the mockup.

---

## 4. Content Decisions (Darren's "undecided" items → resolved defaults)

Each maps to a line in his voice note. All are reversible and listed in the Review Checklist.

| # | Darren said | Decision (default applied) |
|---|---|---|
| A | "reference to the money — take out for all of these … add at the bottom or a separate section … might look weird with free space" | **Remove the per-scholarship dollar amounts** from the eligibility table and the "$8–10k" figure from the SUFS cards. Replace with **one soft funding-note callout** at the bottom of the Eligibility section: funding varies by scholarship/family; we review the actual balance during the free consult. No sparse standalone section. |
| B | "What your scholarship covered — change to *training* instead of *coaching*, maybe *online performance* … not just coaching, it's the online program … a more rounded package" | Rename services: **"In-Person Performance Coaching" → "In-Person Performance Training"**; **"Online Performance Coaching" → "Online Performance Program"** (described as individualized programming + coaching delivered through the app). Keep section title "What Your Scholarship Covers." |
| C | "Package … an entry point … more of a hybrid — one in person, a small group, one or two online through the app … a bit more of a hybrid approach" | Reframe the flagship (was "Monthly Performance Package") as a **"Hybrid Performance Package" (Most Popular)**: in-person session(s) + small-group training + online app-based sessions/programming. The Assessment remains the one-time entry point. |
| D | "load monitoring, recovery tracking … I'm not fully in place to provide this" | **Remove the "Load monitoring & recovery tracking" bullet** from the package — don't promise what isn't deliverable yet. |
| E | "agility … I don't know about the 8-week thing … maybe run it as a clinic, an 8-week clinic program that coincides with funding being deposited" | Reframe **"Agility Development Program (8-Week Block)" → "Agility Clinic"**, run as a clinic **aligned to each quarterly funding drop** (commitment softened, no rigid 8-week claim). |
| F | "not too sure what this one is — a suggested one from Claude and Charles" | Ambiguous which card. **Keep all offerings** but flag the two most speculative — **Homeschool PE Program** and **Performance Camps** — for Darren to confirm/cut. (Homeschool PE is well-aligned with the PEP segment the page itself calls highest-opportunity, so it's kept by default.) |
| G | Claims & numbers from the AI mockup | Ported **as-is** but flagged for verification: "officially approved provider / listed in EMA" (legal/trust claim — **highest priority to confirm before publish**), 20+ yrs, 500+ athletes, 5.0/49 reviews, 15+ sports, phone (877) 735-7837, EMA portal name. |

Disclaimers retained (legally protective): "Confirm eligibility and coverage with Step Up For Students before booking," kept in the form sub-text and a footer-style compliance note at the bottom of the page.

---

## 5. Lead Form (`StepUpInquiryForm`) — behavior

Client component, mirrors `InquiryForm`'s submit/error/redirect logic but with scholarship-specific fields. **No backend changes.**

Captured fields → mapping onto `inquiryFormSchema`:
- Parent/Guardian name → `name`
- Email → `email`; Phone → `phone`
- Athlete's age, Athlete's sport → `sport` gets the sport; age folded into `goals`
- Scholarship type (FES-EO / FES-UA / PEP (Homeschool) / FTC / Not sure) → folded into `goals`
- "Service interested in" (friendly labels) → mapped to the `service` enum:
  - Assessment → `assessment`; Hybrid Performance Package → `in_person`; Online Performance Program → `online`; Agility Clinic → `clinic`; Performance Camp → `camp`; Homeschool PE → `in_person`; **Not sure / need guidance → `assessment`** (universal entry point; true intent preserved in `goals`).
- Free-text message → appended to `goals`.
- `how_heard` defaulted to **"Step Up For Students page"** so the coach can see the lead source.

`goals` is composed as a structured, human-readable block, e.g.:
```
[Step Up For Students inquiry]
Scholarship: FES-UA
Athlete age: 14
Interested in: Hybrid Performance Package

<their message>
```
This guarantees `goals` clears the 10-char minimum and the coach sees scholarship type + intent in the admin notification/email. On success → `router.push("/application-received")`, identical to `InquiryForm`.

---

## 6. Theme Mapping (mockup → DJP)

| Mockup | DJP equivalent |
|---|---|
| `--gold` / `--gold-lt` (accents, CTAs) | `accent` (Gray Orange) / semantic accent classes |
| `--black`/`--dark`/`--card` (dark bg) | Hero & CTA on `bg-primary` (Green Azure) with white text; body sections on white / `bg-surface` alternating |
| `--green` (eligible/success) | `text-success` / accent for the "PE Eligible" tags |
| Inter font | Lexend (auto via globals: `font-heading` / body) |
| Emoji icons | Lucide icons |
| Custom nav/footer/notice banner | Shared `SiteNavbar`/`Footer`; in-page accent banner strip for the announcement |

No hardcoded hex; semantic Tailwind classes only (per project rules).

---

## 7. Files

**New**
- `app/(marketing)/step-up-for-students/page.tsx` — server component, metadata, all sections, JSON-LD.
- `app/(marketing)/step-up-for-students/loading.tsx` — skeleton (mirrors `in-person/loading.tsx`).
- `components/public/StepUpInquiryForm.tsx` — scholarship-aware client form → `/api/inquiry`.

**Edited**
- `app/sitemap.ts` — add `/step-up-for-students` (priority ~0.8, monthly).
- `lib/constants.ts` — add a footer link to the page (in an appropriate `FOOTER_SECTIONS` group).

---

## 8. Verification plan

- `tsc` clean on the new/edited files (against the known pre-existing test/.next baseline noise).
- `npm run lint` clean.
- `npm run build` succeeds (route renders).
- Manual reasoning pass / subagent code review for content accuracy, brand-class usage, form mapping correctness, and a11y.
- Full `npm test` run = no new failures vs. the green baseline (suite was 2086/0 as of 2026-06-13).

---

## 9. Review Checklist for Darren (surface on return)

1. **Confirm the "officially approved Step Up For Students provider / listed in EMA" claim is accurate** before this page goes live (legal/trust claim).
2. Funding amounts removed from the eligibility table — approve the single soft funding note, or supply the exact figures/wording you want.
3. Service rename: "In-Person Performance Training" + "Online Performance Program" — approve wording or suggest the "more rounded" term you were reaching for.
4. Flagship reframed as a **Hybrid Performance Package** (in-person + small group + online app) — confirm the mix.
5. "Load monitoring & recovery tracking" removed — re-add when you're set up to deliver it.
6. Agility reframed as a **clinic aligned to funding quarters** (no fixed 8-week claim) — confirm format.
7. The "not sure what this is" package: confirm whether to keep **Homeschool PE Program** and **Performance Camps**, or cut/reword.
8. Verify proof numbers (20+ yrs, 500+ athletes, 5.0/49 reviews, 15+ sports) and the phone/EMA portal references.
9. Decide whether to add the page to the **top nav** (currently footer link only).
10. Optionally migrate the 8 FAQs into the CMS so they're admin-editable.
