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

import { BUSINESS_INFO, postalAddressSchema } from "@/lib/business-info"

export const DJP_AUTHOR_ID = "https://www.darrenjpaul.com/about#person"

/**
 * Verified canonical sameAs URLs — every external profile that should be
 * part of Darren's entity-graph footprint. Each entry should reciprocally
 * link back to https://www.darrenjpaul.com/about for the chain to be trusted.
 *
 * TODO (owner): add Google Scholar, ORCID, ResearchGate, YouTube, Twitter/X,
 * podcast appearance pages, and federation directory profiles (NSCA, USAW)
 * once URLs are verified.
 */
export const DJP_SAME_AS = [
  "https://www.linkedin.com/in/darren-paul-phd-b022a213b",
  "https://www.instagram.com/darrenjpaul/",
  "https://www.tiktok.com/@darrenpaul_coach",
  "https://www.facebook.com/share/1BwzDFUg66/?mibextid=wwXIfr",
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
    name: "USA Weightlifting Level 2 Coach",
    credentialCategory: "Professional certification",
    recognizedBy: {
      "@type": "Organization",
      name: "USA Weightlifting",
      url: "https://www.usaweightlifting.org/",
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
 */
const KNOWS_ABOUT = [
  "sports performance coaching",
  "return to sport assessment",
  "strength and conditioning",
  "athletic performance development",
  "load and readiness monitoring",
  "long-term athlete development",
  "movement screening",
  "the Grey Zone framework",
  "Five Pillar Framework",
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
 * Full Person schema for /about. Includes credentials, expertise, employer,
 * and address binding. This is the author-entity-verification anchor that
 * 2026 research identifies as a primary AI Overview citation signal.
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
    "Darren J Paul, PhD is a sports performance coach and performance strategist based in Zephyrhills, Florida. Two decades inside high-performance environments, with 500+ athletes coached across 15+ sports and 3 continents — including WTA professionals and pro pickleball players. Author of the Grey Zone coaching philosophy and the Five Pillar Framework. CSCS, NASM, and USA Weightlifting Level 2 certified.",
  image: "https://www.darrenjpaul.com/images/professionalheadshot.jpg",
  url: "https://www.darrenjpaul.com/about",
  worksFor: {
    "@type": "Organization",
    "@id": "https://www.darrenjpaul.com/#organization",
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
