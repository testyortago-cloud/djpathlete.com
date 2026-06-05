// lib/brand/author.ts
// Single source of truth for the Darren J Paul Person JSON-LD.
// Used on /about, every blog post, and (where author attribution is needed)
// across the marketing site.
//
// Per 2026 E-E-A-T research, the sameAs chain + hasCredential + alumniOf
// fields are the strongest author-entity signals for AI Overview citation.
// Treat this file as the canonical author entity — every consumer reflects it.
//
// IMPORTANT: Never fabricate credentials, awards, or affiliations. Google's
// "spammy structured data" filter penalizes schema claims that don't match
// visible page content. Fields marked TODO are blocked on owner data — leave
// them out of the schema until verified.

import { BUSINESS_INFO, GOOGLE_MAPS_URL, postalAddressSchema } from "@/lib/business-info"

export const DJP_AUTHOR_ID = "https://www.darrenjpaul.com/about#person"

/**
 * Verified canonical sameAs URLs — every external profile that should be
 * part of Darren's entity-graph footprint. Each entry should reciprocally
 * link back to https://www.darrenjpaul.com/about for the chain to be trusted.
 *
 * TODO (owner): add Google Scholar, ORCID, ResearchGate, YouTube, Twitter/X,
 * podcast appearance pages, and federation directory profiles (NSCA)
 * once URLs are verified.
 */
export const DJP_SAME_AS = [
  "https://www.linkedin.com/in/darren-paul-phd-b022a213b",
  "https://www.instagram.com/darrenjpaul/",
  "https://www.tiktok.com/@darrenpaul_coach",
  "https://www.facebook.com/share/1BwzDFUg66/?mibextid=wwXIfr",
  // GBP listing — binds the Person entity to the Google Business Profile so
  // Google's knowledge graph resolves "Darren J Paul" to the verified
  // local-business listing, not a confused duplicate or de Paul / YORTAGO.
  GOOGLE_MAPS_URL,
] as const

/**
 * Verified credentials surfaced in /about page UI. Each maps to an
 * EducationalOccupationalCredential with the recognizing organization.
 *
 * TODO (owner): confirm B.S. and PhD university names + dates so we can
 * add `alumniOf` entries with sameAs to Wikipedia URLs of those institutions.
 * Never encode a placeholder university name — leave alumniOf out until
 * verified.
 */
const CREDENTIALS = [
  {
    "@type": "EducationalOccupationalCredential",
    name: "Doctor of Philosophy (PhD)",
    credentialCategory: "degree",
    // recognizedBy: TODO once university confirmed
  },
  {
    "@type": "EducationalOccupationalCredential",
    name: "Certified Strength and Conditioning Specialist (CSCS)",
    credentialCategory: "Professional certification",
    recognizedBy: {
      "@type": "Organization",
      name: "National Strength and Conditioning Association",
      url: "https://www.nsca.com/",
    },
  },
  {
    "@type": "EducationalOccupationalCredential",
    name: "NASM Certified Personal Trainer",
    credentialCategory: "Professional certification",
    recognizedBy: {
      "@type": "Organization",
      name: "National Academy of Sports Medicine",
      url: "https://www.nasm.org/",
    },
  },
  {
    "@type": "EducationalOccupationalCredential",
    name: "B.S. in Exercise Science & Kinesiology",
    credentialCategory: "degree",
    // recognizedBy: TODO once university confirmed
  },
] as const

/**
 * Topics Darren is publicly knowledgeable about. These map to entities
 * Google can recognize. Each phrase should be naturally referenced in
 * page copy too — schema and visible content must match.
 *
 * The first 5 entries are customer-validated themes from the GBP review
 * topic clusters (Google's own NLP extraction). Reinforcing these in
 * schema binds the entity graph to customer language.
 */
const KNOWS_ABOUT = [
  // Customer-validated topics from GBP review themes
  "injury prevention",
  "personalized programming",
  "tailored workouts",
  "knowledge of anatomy",
  "tennis performance",
  // Methodology and service categories
  "sports performance coaching",
  "return to sport assessment",
  "strength and conditioning",
  "athletic performance development",
  "load and readiness monitoring",
  "long-term athlete development",
  "movement screening",
  "force plate testing",
  "post-injury return to performance",
] as const

/**
 * Compact author reference for use as `author` field on Article/BlogPosting
 * schemas. Keeps blog post JSON-LD lean while still binding to the canonical
 * Person entity at /about#person.
 */
export const DJP_AUTHOR_PERSON = {
  "@type": "Person" as const,
  "@id": DJP_AUTHOR_ID,
  name: "Darren J Paul",
  alternateName: "Dr. Darren Paul",
  honorificSuffix: "PhD, CSCS",
  url: "https://www.darrenjpaul.com/about",
  image: "https://www.darrenjpaul.com/images/professionalheadshot.jpg",
  jobTitle: "Sports Performance Coach",
  sameAs: [...DJP_SAME_AS],
}

/**
 * Person.hasCredential entries are now sourced from `about_page_content` so
 * the coach can add a new certification in /admin/marketing/about and have it
 * appear automatically in BOTH the visible card grid AND the structured E-E-A-T
 * signal. Call `buildAboutPersonSchema(credentials)` from /about to produce a
 * schema that inherits everything in DJP_PERSON_FULL but overrides
 * hasCredential with the CMS-managed list.
 */
type CmsCredential = {
  title: string
  category: "degree" | "certification" | "experience"
  recognizing_org?: string
  recognizing_url?: string
}

export function buildAboutPersonSchema(credentials: CmsCredential[]) {
  return {
    ...DJP_PERSON_FULL,
    hasCredential: credentials.map(cmsCredentialToSchema),
  }
}

function cmsCredentialToSchema(c: CmsCredential) {
  const credentialCategory =
    c.category === "degree"
      ? "degree"
      : c.category === "certification"
        ? "Professional certification"
        : "Professional experience"
  const base: Record<string, unknown> = {
    "@type": "EducationalOccupationalCredential",
    name: c.title,
    credentialCategory,
  }
  if (c.recognizing_org) {
    base.recognizedBy = {
      "@type": "Organization",
      name: c.recognizing_org,
      ...(c.recognizing_url ? { url: c.recognizing_url } : {}),
    }
  }
  return base
}

/**
 * Full Person schema for /about — static defaults. The hasCredential array
 * here is the **fallback**; the live /about page calls
 * buildAboutPersonSchema(content.credentials) to override it with the
 * CMS-managed list so the structured signal stays in sync with what the
 * coach has actually published.
 */
export const DJP_PERSON_FULL = {
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": DJP_AUTHOR_ID,
  name: "Darren J Paul",
  alternateName: ["Darren Paul", "Dr. Darren Paul"],
  honorificPrefix: "Dr.",
  honorificSuffix: "PhD, CSCS",
  jobTitle: "Sports Performance Coach & Performance Strategist",
  description:
    "Darren J Paul, PhD is a sports performance coach and performance strategist based in Zephyrhills, Florida. Two decades inside high-performance environments, with 500+ athletes coached across 15+ sports and 3 continents — including WTA professionals and pro pickleball players. CSCS and NASM certified.",
  image: "https://www.darrenjpaul.com/images/professionalheadshot.jpg",
  url: "https://www.darrenjpaul.com/about",
  // Bind to the LocalBusiness @id declared on the homepage so Google joins
  // Person → LocalBusiness → GBP into a single verified entity. The earlier
  // "#organization" reference was dangling — no schema declared that @id.
  worksFor: {
    "@type": "SportsActivityLocation",
    "@id": "https://www.darrenjpaul.com/#localbusiness",
    name: BUSINESS_INFO.legalName,
  },
  workLocation: {
    "@type": "Place",
    name: BUSINESS_INFO.legalName,
    address: postalAddressSchema,
  },
  knowsAbout: [...KNOWS_ABOUT],
  knowsLanguage: ["en"],
  hasCredential: [...CREDENTIALS],
  memberOf: [
    {
      "@type": "Organization",
      name: "National Strength and Conditioning Association",
      url: "https://www.nsca.com/",
    },
  ],
  sameAs: [...DJP_SAME_AS],
} as const
