// Seed script — About page FAQs
//
// Populates the `faqs` table for page_key 'about' so the ManagedFaqSection on
// /about renders. Content is grounded strictly in the existing /about page
// copy (bio, credentials, methodology, location) — no invented facts.
//
// Idempotent: if 'about' already has rows, the script skips and exits.
//
// Run: npx tsx scripts/seed-about-faqs.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { createFaq, listFaqsForPage } from "@/lib/db/faqs"

type SeedFaq = {
  question: string
  answer: string
  link_text: string | null
  link_href: string | null
}

const aboutFaqs: SeedFaq[] = [
  {
    question: "Who is Darren J Paul?",
    answer:
      "Darren J Paul, PhD, is a sports performance coach and the founder of DJP Athlete, based in Zephyrhills, Florida (Tampa Bay area). He has spent two decades inside high-performance environments and has coached 500+ athletes across 15+ sports and three continents, including WTA professional tennis players and professional pickleball players. He is the author of the Grey Zone coaching philosophy and the Five Pillar Framework.",
    link_text: null,
    link_href: null,
  },
  {
    question: "What are Darren J Paul's qualifications and certifications?",
    answer:
      "Darren holds a Doctor of Philosophy (PhD) and a B.S. in Exercise Science & Kinesiology. His certifications include Certified Strength & Conditioning Specialist (CSCS) through the NSCA, NASM Certified Personal Trainer, and USA Weightlifting Level 2 Coach — backed by two decades of high-performance coaching experience.",
    link_text: null,
    link_href: null,
  },
  {
    question: "Where is DJP Athlete based?",
    answer:
      "DJP Athlete is based in Zephyrhills, Florida, in the Tampa Bay area. In-person coaching is delivered at the Zephyrhills facility, and online coaching is available to athletes worldwide.",
    link_text: "See in-person coaching",
    link_href: "/in-person",
  },
  {
    question: "What is the Five Pillar Framework?",
    answer:
      "The Five Pillar Framework is the methodology Darren built every program around: assessment, individualized programming, load monitoring, technical coaching, and long-term development. It is diagnostic-driven — every program is built from real data on movement, force and load tolerance, then adjusted in real time rather than following a fixed template.",
    link_text: null,
    link_href: null,
  },
  {
    question: "What kinds of athletes does Darren coach?",
    answer:
      "Darren coaches serious athletes at every stage — professional, collegiate and competitive amateur, youth in long-term development, and athletes returning from injury. The same training framework runs each stage, scaled to training age, sport and competition calendar.",
    link_text: "View athlete stages",
    link_href: "/athletes",
  },
  {
    question: "How is DJP Athlete different from a training app or template program?",
    answer:
      "DJP Athlete is positioned in deliberate contrast to template-based or self-service training apps. Every program is built from diagnostic data — movement quality, force, load tolerance and sport demands — and adjusted weekly based on wellness markers and video review. The approach is systems over exercises, patterns over shortcuts.",
    link_text: null,
    link_href: null,
  },
  {
    question: "Can I work with Darren if I don't live in Florida?",
    answer:
      "Yes. Alongside in-person coaching at the Zephyrhills facility, Darren delivers online coaching for athletes worldwide and return-to-performance assessments for athletes coming back from injury. Online coaching uses the same Five Pillar Framework, delivered remotely.",
    link_text: "See online coaching",
    link_href: "/online",
  },
]

async function seed() {
  console.log("📋 Seeding About-page FAQs...\n")

  const existing = await listFaqsForPage("about")
  if (existing.length > 0) {
    console.log(`  about: skipped, already seeded (${existing.length} rows)`)
    return
  }

  for (const f of aboutFaqs) {
    await createFaq({ page_key: "about", category: null, status: "published", ...f })
  }
  console.log(`  about: ${aboutFaqs.length} inserted`)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
