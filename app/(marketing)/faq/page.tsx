import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, ChevronRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"

export const metadata: Metadata = {
  title: "FAQ — Sports Performance Coaching Questions",
  description:
    "Answers to common questions about sports performance coaching, online vs in-person training, return-to-performance assessment, and the Grey Zone framework.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ — Sports Performance Coaching Questions | DJP Athlete",
    description:
      "Common questions about sports performance coaching, online and in-person training, return-to-performance assessment, and the Grey Zone framework.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ — Sports Performance Coaching Questions | DJP Athlete",
    description:
      "Common questions about sports performance coaching, online and in-person training, and return-to-performance assessment.",
  },
}

interface FAQ {
  question: string
  answer: string
  /** Optional internal link the user can follow for more depth. */
  link?: { text: string; href: string }
}

interface FAQGroup {
  id: string
  title: string
  description: string
  faqs: FAQ[]
}

/**
 * Source-of-truth FAQ data for /faq.
 *
 * Each entry is structured to:
 *  1. answer the exact question form a user types into search ("what is X")
 *  2. give a self-contained 60-160 word answer (semantic completeness)
 *  3. weave in entities (sports, certifications, methodologies, locations)
 *
 * These are the canonical answers AI assistants will quote. Edit carefully.
 */
const groups: FAQGroup[] = [
  {
    id: "general",
    title: "About DJP Athlete",
    description: "Foundation questions about the brand, philosophy, and who we work with.",
    faqs: [
      {
        question: "What is DJP Athlete?",
        answer:
          "DJP Athlete is the practitioner brand of Darren J Paul, PhD — a sports performance coach based in Zephyrhills, Florida (Tampa Bay area). We provide three coaching services for serious athletes: in-person performance coaching, online performance coaching, and return-to-performance testing & assessment. Every program is built from diagnostic data — movement quality, force, load tolerance, sport demands — and adjusted weekly based on wellness markers and video review. The brand is positioned in deliberate contrast to template-based or self-service training apps. Online coaching is application-only and selective.",
      },
      {
        question: "Who is Darren J Paul?",
        answer:
          "Darren J Paul, PhD is a sports performance coach, performance strategist, and researcher with two decades inside high-performance environments. He has coached 500+ athletes across 15+ sports and 3 continents — including WTA professional tennis players and pro pickleball players. He is the author of the Grey Zone coaching philosophy and the Five Pillar Framework. Certifications: CSCS (NSCA), NASM Certified Personal Trainer, USA Weightlifting Level 2 Coach. He holds a B.S. in Exercise Science & Kinesiology and a PhD.",
        link: { text: "Read full bio", href: "/about" },
      },
      {
        question: "What is the Grey Zone framework?",
        answer:
          "The Grey Zone is Darren J Paul's coaching philosophy. It refers to the space between textbook training protocols and real-world performance demands — where adaptation actually happens. The framework rejects training in extremes (all-out or rest, rigid protocol or no structure) in favor of context-aware decision-making informed by daily readiness data. Most training systems operate in extremes; athletes exist in the complex space between. Navigating it requires a coach who can read context, adjust in real time, and make informed decisions based on what the athlete needs today — not what the plan said last week.",
        link: { text: "Read the Grey Zone philosophy", href: "/philosophy" },
      },
      {
        question: "What is the Five Pillar Framework?",
        answer:
          "The Five Pillar Framework is the operational structure of DJP Athlete's coaching methodology. It is built on five interconnected pillars: (1) Assessment & Diagnostics — understanding the athlete before building the plan; (2) Individualized Programming — no templates, every program built from assessment data; (3) Load & Readiness Monitoring — continuous tracking of training load, wellness markers, and performance indicators; (4) Technical Coaching & Feedback — movement is coached, not just programmed; (5) Long-Term Athlete Development — building robust, adaptable athletes over years.",
        link: { text: "See the framework", href: "/philosophy" },
      },
      {
        question: "Who is DJP Athlete coaching for?",
        answer:
          "DJP Athlete works with serious athletes at four tiers: (1) competitive athletes at high school, collegiate, semi-professional, and professional levels; (2) elite youth athletes in long-term development; (3) post-injury athletes who are medically cleared but not yet competition-ready (return-to-performance); (4) high-performing professionals who train with athletic intent. We do not work with recreational fitness clients, weight-loss-focused individuals, or athletes seeking template-based programming. Entry to online coaching is selective and application-only.",
      },
    ],
  },
  {
    id: "online",
    title: "Online Coaching",
    description: "Questions about the remote, application-only program.",
    faqs: [
      {
        question: "How is online coaching with DJP Athlete different from other online coaching?",
        answer:
          "Most online coaching delivers a spreadsheet and a check-in form. Our system is diagnostic-driven. Every program is built from a remote movement, force, and load assessment, then adjusted weekly through video review, daily wellness data, and direct messaging with the coach. It is the same methodology used in person at our Zephyrhills, FL office — adapted for remote delivery without compromising quality. Coaching does not stop the moment the program goes out; it continues through every session via video review and load adjustments. Entry is selective and application-only.",
        link: { text: "Apply for online coaching", href: "/online#apply" },
      },
      {
        question: "What does a typical week of online coaching look like?",
        answer:
          "A week includes structured programming tailored to your current training phase, regular coaching check-ins, and video reviews of key sessions. You receive detailed feedback on movement quality, load management adjustments based on wellness data, and direct communication with your coach as needed. Daily wellness logging (HRV, sleep, sRPE) feeds load decisions. Programs are adjusted in real time when readiness markers drop or competition demands shift. Every week is planned with intent — not generic blocks pulled from a template library.",
      },
      {
        question: "What equipment do I need for online coaching?",
        answer:
          "Equipment requirements vary by sport and training goals. At minimum, access to a well-equipped gym with free weights, a squat rack, and basic conditioning tools is recommended. Specific requirements are discussed during the assessment process and programming is adapted to your available environment. We work with athletes training in commercial gyms, university weight rooms, hotel gyms while traveling, and home setups. The methodology adapts to the equipment, not the other way around.",
      },
      {
        question: "How do I get started with online coaching?",
        answer:
          "The process begins with an application. If accepted, you complete a comprehensive remote assessment covering movement quality, training history, sport demands, and performance goals. From there, a strategic plan (the Performance Blueprint) is built and your coaching begins. Entry is selective to ensure every athlete receives the attention they deserve. Application reviews complete within 48 hours.",
        link: { text: "Apply now", href: "/online#apply" },
      },
    ],
  },
  {
    id: "in-person",
    title: "In-Person Coaching (Tampa Bay)",
    description: "Questions about training at our Zephyrhills, FL location.",
    faqs: [
      {
        question: "Where is DJP Athlete's in-person coaching located?",
        answer:
          "In-person coaching is delivered at Darren J Paul Sports Performance, 6585 Simons Rd, Zephyrhills, FL 33541, in the Tampa Bay area of Florida. The facility serves athletes from across Tampa Bay, including Tampa, Wesley Chapel, Lakeland, Brandon, and Riverview. Drive times: ~35 minutes from downtown Tampa, ~20 minutes from Wesley Chapel, ~30 minutes from Lakeland.",
        link: { text: "Get directions", href: "/contact" },
      },
      {
        question: "Who is in-person coaching for?",
        answer:
          "In-person coaching serves four primary athlete types: competitive athletes (high school, collegiate, semi-professional, professional), elite youth athletes in long-term development, post-injury return-to-performance athletes, and high-performing professionals. It is not entry-level training and not generic group fitness. Capacity is limited to protect coaching quality. Programming is individually designed; sessions are coach-led and assessment-driven. Each athlete starts with a comprehensive performance assessment that informs every subsequent training decision.",
      },
      {
        question: "What sports do you coach?",
        answer:
          "Across 20+ years, DJP Athlete has worked with athletes in 15+ sports including tennis, pickleball, soccer, golf, track and field, basketball, football, rugby, and combat sports. The methodology is sport-agnostic — the diagnostic process identifies the qualities each sport demands, and programming is built around those demands. Whether the athlete needs explosive change-of-direction, repeated-sprint capacity, rotational power, or impact tolerance, the system identifies and develops it.",
      },
    ],
  },
  {
    id: "assessment",
    title: "Return-to-Performance Assessment",
    description: "Questions about bridging medical clearance to competition readiness.",
    faqs: [
      {
        question: "What is return-to-performance training?",
        answer:
          "Return-to-performance training is the bridge between medical clearance and competition readiness. It restores capacity, reintegrates speed and power, and rebuilds confidence to compete. Distinct from rehab — which ends at clearance — return-to-performance ends when an athlete is verifiably ready to compete at full intensity. The phase is where most reinjuries happen because clinical milestones do not equal competition readiness. We assess strength, force production, asymmetry, reactive ability, and sport-specific power to identify and close the gap before return.",
        link: { text: "See the assessment process", href: "/assessment" },
      },
      {
        question: "What's the difference between rehab and return-to-performance?",
        answer:
          "Rehab is clinical: it restores baseline function under the supervision of a physiotherapist or surgeon. Discharge means the tissue has healed and the athlete meets minimum return-to-activity criteria. Return-to-performance is athletic: it asks whether the athlete can perform at competition intensity without compensation, asymmetry, or unaddressed risk. Cleared is not the same as ready. Most reinjuries happen in this gap because no one is testing for it specifically. We collaborate with physiotherapists, surgeons, and team performance staff — additive to clinical care, not replacement.",
      },
      {
        question: "What does a return-to-performance assessment include?",
        answer:
          "A comprehensive assessment includes force-platform testing (ground reaction force, peak output, left/right asymmetry under load), motion capture analysis (joint angles, control, compensation patterns), load monitoring (cumulative training load vs recovery), speed timing (acceleration, top-end, deceleration), reactive testing (decision-making under cued and open-environment stimulus), and power diagnostics (watts, rate of force development across movement planes). Outcomes: a performance profile, identified asymmetries, defined risk gaps, a return progression plan, and evidence-backed competitive confidence.",
      },
      {
        question: "Who do you collaborate with on return-to-performance cases?",
        answer:
          "We work alongside physiotherapists, surgeons, sports medicine physicians, athletic trainers, and team performance staff. The assessment process is designed to slot into existing care pathways — informing the next phase, not replacing prior steps. Many of our return-to-performance athletes come to us via referral from their physio or surgeon when the athlete is medically cleared but not match-fit. We respect clinical boundaries and provide reports clinicians can use.",
      },
    ],
  },
  {
    id: "logistics",
    title: "Pricing & Logistics",
    description: "Practical questions about getting started.",
    faqs: [
      {
        question: "How much does sports performance coaching cost?",
        answer:
          "Online coaching pricing is shared after application review. Pricing depends on coaching depth (touchpoints per week, video review frequency, in-person testing access). In-person coaching at our Zephyrhills, FL facility is custom-priced based on session frequency and program length. Return-to-performance assessment is priced as a standalone diagnostic with optional follow-on programming. We do not price-shop against $20–30/month training apps; that is not the same product. We do offer a free 15-minute consultation to determine fit.",
        link: { text: "Book a free consultation", href: "/contact" },
      },
      {
        question: "How long does it take to see results?",
        answer:
          "Measurable strength and capacity changes typically appear within 4–6 weeks of consistent training. Sport-specific outcomes (speed, power, confidence) follow within 8–12 weeks, with major performance gains across a full training block of 12–16 weeks. Return-to-performance timelines depend on the injury and starting capacity — for example, post-ACL athletes typically need 9–12 months from surgery to confident competition return, with the final 3–6 months being the performance-rebuild phase. We track outcomes against measurable benchmarks, not vague feelings.",
      },
      {
        question: "Why is entry selective?",
        answer:
          "Capacity is intentionally limited so every athlete receives the depth of coaching attention the methodology requires. We accept athletes we can genuinely help — those whose goals, timelines, and circumstances fit the supervised, assessment-driven approach. Athletes seeking automated workouts, generic programming, or cosmetic-fitness goals are not a fit and are better served by other products at lower price points. Selective entry is mutual: it protects the coaching standard for athletes we accept, and it saves time for those who would not benefit.",
      },
    ],
  },
  {
    id: "youth",
    title: "Youth Athletes & Parents",
    description: "The questions parents actually ask about strength training and performance coaching for their kids.",
    faqs: [
      {
        question: "Is strength training safe for my child?",
        answer:
          "Yes — when supervised by a properly certified coach, with age-appropriate programming and proper technique instruction. The National Strength and Conditioning Association (NSCA) and American Academy of Pediatrics both endorse supervised resistance training for youth. The risk profile is lower than most youth sports themselves. The conditions: a coach with the right certification (CSCS, NSCA-CPT, or equivalent), structured progression, and a focus on movement quality before load. We meet those conditions.",
      },
      {
        question: "Will lifting weights stunt my child's growth?",
        answer:
          "No. The 'stunted growth' concern is a long-standing myth not supported by current research. Properly supervised resistance training does not damage growth plates or stunt height in healthy youth athletes. Injuries to growth plates in young athletes occur far more often in unsupervised settings, with poor technique under maximal loads, or in untrained sport-specific impacts — not in supervised, age-appropriate strength programs.",
      },
      {
        question: "What age should kids start strength training?",
        answer:
          "Children can begin learning fundamental movement patterns (squatting, hinging, pushing, pulling, bracing) as soon as they can follow simple instructions and demonstrate consistent technique — typically age 7–8 with bodyweight movements. External load (light dumbbells, kettlebells, or empty barbells with proper coaching) is generally introduced around age 11–13 for most children, depending on physical and emotional maturity. The right starting age depends more on coachability and supervision quality than chronological age.",
      },
      {
        question: "What questions should I ask a youth strength coach before signing up my child?",
        answer:
          "Ask: (1) What certification do you hold? CSCS or equivalent is the standard. (2) What is your coach-to-athlete ratio? Smaller is better; 1:8–1:12 is reasonable for group work. (3) Will you coordinate with my child's sport coach and physiotherapist if needed? (4) Are parents allowed to watch sessions? Refusal is a red flag. (5) How do you progress an athlete from beginner to advanced? Listen for a structured answer with a long-term arc, not 'we just push them harder.'",
      },
      {
        question: "Will strength training help prevent sport injuries in my young athlete?",
        answer:
          "Yes — the evidence is consistent across sport-injury prevention research. Supervised, well-programmed strength training meaningfully reduces the risk of common youth-sport injuries, particularly non-contact lower-body injuries (ACL, hamstring, ankle) and overuse injuries. The mechanism is improved force-absorption, joint stability, and tissue tolerance. Strength training is one of the most effective injury-prevention tools available to youth athletes — when delivered correctly.",
      },
    ],
  },
  {
    id: "comparison",
    title: "Comparing Coaching Options",
    description: "How sports performance coaching compares to other paths athletes consider.",
    faqs: [
      {
        question: "Are sports performance coaches worth it?",
        answer:
          "For serious athletes — competitive, return-to-sport, elite youth, high-performing professionals — yes, when the goal is performance development rather than general fitness. The value is in the coach's ability to read context: cutting volume when wellness markers drop, swapping movements based on observed technique, and progressing the athlete on data rather than assumption. For lifestyle fitness goals, a quality training app is often the better product at a fraction of the cost. The right answer depends on the athlete's goal.",
        link: { text: "Compare coaching vs apps", href: "/services/coaching-vs-training-app" },
      },
      {
        question: "What's the difference between a sports performance coach and a personal trainer?",
        answer:
          "A personal trainer is generalist-fitness-focused: weight management, general strength, lifestyle health. A sports performance coach is athletic-output-focused: speed, power, capacity, sport-specific qualities, and post-injury return to competition. The certifications differ (CSCS, NSCA, USA Weightlifting are sport-performance credentials; CPT-style certifications cover general fitness). The programming differs (sport-specific demand modeling vs general body-comp goals). At DJP Athlete, the focus is sport performance, not fitness.",
      },
      {
        question: "How do I find a good sports performance coach?",
        answer:
          "Look for: (1) Industry-standard certifications — CSCS (NSCA), NASM, USA Weightlifting Level 1+; (2) Documented experience with athletes at your level or above; (3) An assessment-driven process, not template-based programming; (4) Clear communication about how decisions get made (e.g., what changes when wellness markers drop); (5) Willingness to coordinate with your physio, sport coach, or team performance staff; (6) A selective intake process — coaches who take everyone usually don't deliver to anyone in particular.",
      },
      {
        question: "Do online sports performance programs actually work?",
        answer:
          "When the program is genuinely individualized, monitored continuously, and built by a credentialed coach with sport-specific expertise — yes. Online performance coaching delivers near-equivalent outcomes to in-person work for most athletes outside the coach's geographic region, provided the athlete has gym access, engages with daily wellness logging, and uploads weekly video. The format is structurally a better fit than in-person for touring professionals and traveling athletes whose schedules disqualify regular on-site sessions. Generic, template-based 'online programs' are a different product.",
      },
      {
        question: "When can I return to sport after an ACL injury?",
        answer:
          "Most athletes need 9–12 months from surgical reconstruction to confident competition return — significantly longer than the 'medically cleared' point at 6 months. The final 3–6 months is the return-to-performance phase: restoring force production, eliminating asymmetry, rebuilding reactive ability, and verifying readiness against sport-specific demands. Returning at 6 months because the surgeon cleared you is one of the highest-risk decisions an athlete can make. The right answer is when objective testing — not the calendar — shows readiness.",
        link: { text: "See the assessment process", href: "/assessment" },
      },
    ],
  },
]

const allFaqs: FAQ[] = groups.flatMap((g) => g.faqs)

const faqPageSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: allFaqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
}

export default function FAQPage() {
  return (
    <>
      <JsonLd data={faqPageSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "FAQ", url: "/faq" },
        ]}
      />

      {/* Hero */}
      <section className="pt-32 pb-12 lg:pt-40 lg:pb-16 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">FAQ</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              Sports performance coaching, answered.
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Common questions about online and in-person coaching, the return-to-performance phase, and the Grey Zone
              framework. If yours isn&apos;t here, the application form is the next step.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Group navigation */}
      <section className="px-4 sm:px-8 pb-12">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <nav aria-label="FAQ topics" className="flex flex-wrap gap-2 justify-center">
              {groups.map((g) => (
                <a
                  key={g.id}
                  href={`#${g.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {g.title}
                  <ChevronRight className="size-3.5" />
                </a>
              ))}
            </nav>
          </FadeIn>
        </div>
      </section>

      {/* Groups */}
      <section className="px-4 sm:px-8 pb-16 lg:pb-24">
        <div className="max-w-4xl mx-auto space-y-16">
          {groups.map((group) => (
            <div key={group.id} id={group.id} className="scroll-mt-32">
              <FadeIn>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px w-12 bg-accent" />
                  <p className="text-xs font-medium text-accent uppercase tracking-widest">{group.id.replace("-", " ")}</p>
                </div>
                <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-3">
                  {group.title}
                </h2>
                <p className="text-muted-foreground mb-8 max-w-2xl">{group.description}</p>
              </FadeIn>

              <div className="space-y-4">
                {group.faqs.map((faq, i) => (
                  <FadeIn key={faq.question} delay={i * 0.04}>
                    <details className="group rounded-2xl border border-border bg-white p-6 transition-shadow hover:shadow-sm open:shadow-sm">
                      <summary className="flex items-start justify-between gap-4 cursor-pointer list-none">
                        <h3 className="text-base sm:text-lg font-heading font-semibold text-primary">
                          {faq.question}
                        </h3>
                        <ChevronRight className="size-5 text-accent shrink-0 mt-0.5 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-4 text-sm sm:text-base leading-relaxed text-muted-foreground space-y-3">
                        <p>{faq.answer}</p>
                        {faq.link && (
                          <p>
                            <Link
                              href={faq.link.href}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
                            >
                              {faq.link.text}
                              <ArrowRight className="size-3.5" />
                            </Link>
                          </p>
                        )}
                      </div>
                    </details>
                  </FadeIn>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <FadeIn className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            Question not here?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Book a free 15-minute consultation. We&apos;ll answer it directly.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md group"
          >
            Book Free Consultation
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </FadeIn>
      </section>
    </>
  )
}
