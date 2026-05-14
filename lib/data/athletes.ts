/**
 * Audience-segment landing-page content. Each entry produces a page at
 * /athletes/{slug} via the dynamic route, and a card on the /athletes hub.
 * Personas come from .agents/product-marketing-context.md (skip the
 * "Referrer" persona — that's B2B, not a landing-page audience).
 *
 * Same content shape as lib/data/sports.ts so the dynamic route can share
 * the same template logic. Keep copy on-brand: distinctive, anti-fluff,
 * no em-dashes, no AI tells.
 */
export interface AthleteFaq {
  question: string
  answer: string
}

export interface AthleteQuality {
  title: string
  body: string
}

export interface AthleteAudience {
  /** URL slug. Final URL: /athletes/{slug} */
  slug: string
  /** Short display name, used in nav + cards + breadcrumbs. */
  name: string
  /** Visible H1. Carries the primary keyword for this segment. */
  h1: string
  /** Page meta description, kept under 155 chars. */
  description: string
  /** Hero hook line. One sentence, brand voice. */
  hook: string
  /** Short tagline used on the hub card. */
  cardTagline: string
  /** PeopleAudience.audienceType for the Service schema. */
  audienceType: string
  /** Question for the SemanticAnswerBlock. */
  answerQuestion: string
  /** 134–167 word self-contained answer (the AI-extractable block). */
  answer: string
  /** Four qualities we develop for this athlete type. */
  qualities: [AthleteQuality, AthleteQuality, AthleteQuality, AthleteQuality]
  /** Realistic 12-week outcomes for this audience. */
  outcomes: string[]
  /** Six audience-specific FAQs. */
  faqs: AthleteFaq[]
  /** Slug under /programs/* if a related program exists. */
  relatedProgramSlug?: string
  /** Pull-quote testimonial where one applies. */
  testimonialQuote?: { quote: string; attribution: string }
  /** Internal money-page CTAs ordered by best fit. */
  primaryCta: { label: string; href: string }
  secondaryCta: { label: string; href: string }
}

export const ATHLETES: AthleteAudience[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "professional",
    name: "Professional",
    h1: "Sports Performance Coaching for Professional Athletes",
    description:
      "Sports performance coaching for professional athletes: travel-friendly programming, in-season load management and career longevity. By Darren J Paul, PhD.",
    hook: "Continuity across continents. Coaching that travels with you.",
    cardTagline: "Touring players, in-season load management, career longevity.",
    audienceType:
      "Professional athletes across tennis, golf, pickleball, baseball, soccer and rotational sports",
    answerQuestion: "What is sports performance coaching for professional athletes?",
    answer:
      "Sports performance coaching for professional athletes is a year-round, individualized system designed around the realities of a touring career: travel, time-zone changes, unfamiliar venues, tournament density and the in-season conditioning demand. At DJP Athlete, professional athletes are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), who has worked with WTA professionals and professional pickleball players among 500+ athletes coached across 15+ sports and three continents. The system runs remotely as standard, in-person at the Tampa Bay facility during home blocks, with weekly programming, video feedback, daily load monitoring and direct coach access. Programming adjusts in real time to wellness markers, tournament schedule and the equipment available at the venue. The aim is straightforward: longer careers, fewer in-season setbacks, and an entry into each peak window the player can actually use.",
    qualities: [
      {
        title: "Travel-friendly programming",
        body: "Built around your schedule, your time zones, and the equipment available at any hotel or venue gym. The plan moves with you instead of breaking when you leave home.",
      },
      {
        title: "In-season load management",
        body: "Tournament density, match congestion and back-to-back travel get monitored as actual load, not assumed load. We cut volume when wellness markers say cut, not because the spreadsheet expected to.",
      },
      {
        title: "Career longevity, not eight-week peaks",
        body: "Programs are built around the next two to four years, not the next testing block. Sustainable output is the standard, and load is managed to protect the peak windows that decide rankings.",
      },
      {
        title: "Direct coach access",
        body: "No DM dead-ends, no auto-replies, no template hand-offs. Weekly check-ins, video review and ongoing decisions made on your behalf by the coach who designed the plan.",
      },
    ],
    outcomes: [
      "Cleaner entry into each peak window with no in-season volume dropoff",
      "Fewer late-career soft-tissue setbacks under tournament density",
      "Repeatable serve/strike speed across long matches and back-to-back days",
      "Coordinated load management with physios, agents and team performance staff",
    ],
    faqs: [
      {
        question: "Can you really coach a touring player remotely?",
        answer:
          "Yes. The online program is built for athletes who travel. Weekly programming adjusts around your tournament schedule and the equipment available at the venue, with video feedback and ongoing oversight. WTA professionals already run this format.",
      },
      {
        question: "I already have a team S&C coach. Does this replace them?",
        answer:
          "No. We collaborate. Many of our professional athletes have a team or tour S&C presence; we work alongside it, particularly during off-season and return-to-play blocks, and we share data and intent transparently so nobody is working at cross-purposes.",
      },
      {
        question: "How does in-season programming work when I'm playing every week?",
        answer:
          "Reduced volume, maintained intent. Sessions are shorter and more focused, with strength and power kept at a load that maintains output but does not interfere with matches. Detraining mid-season is one of the most common ways professionals lose late-season form.",
      },
      {
        question: "What if I'm recovering from an in-season injury?",
        answer:
          "We work alongside your medical team and physio. Once you have clearance, the program closes the gap between cleared and competition-ready with diagnostic testing and structured reloading.",
      },
      {
        question: "How quickly do you respond to messages?",
        answer:
          "Within hours during the working day, faster around competition windows. Direct coach access is part of the package, not an upsell.",
      },
      {
        question: "What does it cost?",
        answer:
          "Professional engagements are application-only and bespoke to the season schedule. Apply and we will follow up within 48 hours to confirm fit and pricing.",
      },
    ],
    testimonialQuote: {
      quote:
        "He's truly the best coach I've ever worked with. The Online Program helps me stay connected even though I am training independently.",
      attribution: "Ganna Poznikhierenko, WTA Professional Tennis Player",
    },
    primaryCta: { label: "Apply, online (worldwide)", href: "/online" },
    secondaryCta: { label: "In-person, Tampa Bay home blocks", href: "/in-person" },
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "collegiate",
    name: "Collegiate & Amateur",
    h1: "Sports Performance Training for Collegiate and Competitive Amateur Athletes",
    description:
      "Sports performance training for college athletes and serious amateurs: diagnostic-driven programming, year-round periodization, real coaching. Tampa Bay and online.",
    hook: "Trained like a pro, before you are one.",
    cardTagline: "College players, competitive amateurs, real assessment.",
    audienceType: "Collegiate athletes and competitive amateurs at every level",
    answerQuestion: "What is sports performance training for collegiate and amateur athletes?",
    answer:
      "Sports performance training for collegiate and competitive amateur athletes is a structured, year-round development system designed around an athlete's sport, training history and current outputs. Most college and amateur athletes are over-trained and under-coached; they get given the same program as everyone on the roster and a YouTube routine for the off-season. At DJP Athlete, coaching starts with a diagnostic of where the athlete actually sits on force production, asymmetry, movement quality and sport-specific outputs, then builds an individualized plan around it. The same Five Pillar Framework that runs professional engagements (assessment, individualized programming, load monitoring, technical coaching, long-term development) runs the collegiate work too, scaled to the athlete's stage. Delivered in-person at the Tampa Bay facility and online for athletes anywhere. Coaching is by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), 500+ athletes coached across 15+ sports.",
    qualities: [
      {
        title: "Diagnostic-driven baseline",
        body: "Force production, asymmetry, movement quality and sport-specific outputs measured before the plan is built. The starting point is your data, not a generic template.",
      },
      {
        title: "Year-round periodization",
        body: "Off-season, pre-season, in-season and post-season blocks built around your sport calendar. Different intent and load for each, not the same plan twelve months a year.",
      },
      {
        title: "Strength that transfers to sport",
        body: "Force production trained alongside the speed, change of direction and rotational power your sport actually rewards. The transfer is the point.",
      },
      {
        title: "Real technical coaching",
        body: "Every lift, sprint and drill is coached. Cues, video, feedback. Reps that change the picture, not reps that fill the hour.",
      },
    ],
    outcomes: [
      "Better numbers on the tests your program actually measures (sprint times, jump heights, lifts)",
      "More high-intensity actions per match without the second-half drop",
      "Fewer soft-tissue and overuse issues across a long season",
      "A plan you can defend to a team coach or physio because it is built from data",
    ],
    faqs: [
      {
        question: "I already have a strength coach at school. Should I still work with you?",
        answer:
          "Many of our collegiate athletes do. We work as the year-round individualized layer, particularly in the off-season and around return-to-play windows where the team programming can be light. We share intent and data with your team coach so nothing conflicts.",
      },
      {
        question: "How does this differ from a personal trainer?",
        answer:
          "A personal trainer focuses on general fitness. A sports performance coach builds the qualities a sport actually rewards, starting from a diagnostic. Programs change weekly based on wellness and load. The work is designed around the sport, not the gym leaderboard.",
      },
      {
        question: "Is this for any level of college athlete, or only D1?",
        answer:
          "Any level, plus competitive amateurs outside the college system. The bar is intent, not status. The Five Pillar Framework scales with training age, not with division.",
      },
      {
        question: "What about my parents or coach getting visibility into the plan?",
        answer:
          "Programming is shared transparently. Parents, school coaches and physios are welcome to review the plan, and we routinely coordinate with team performance staff and clinicians where it serves the athlete.",
      },
      {
        question: "Can I train remotely once I head back to school?",
        answer:
          "Yes. The online program is built for that. Weekly programming follows your school schedule and term breaks, with video feedback and load monitoring. Pre-season and summer blocks often run in-person at our Tampa Bay facility for athletes within reach.",
      },
      {
        question: "What does it cost?",
        answer:
          "Coaching is application-only and priced around format and frequency. Apply with your sport, level and goals and we will follow up within 48 hours.",
      },
    ],
    primaryCta: { label: "Apply for coaching", href: "/online" },
    secondaryCta: { label: "Start with an assessment", href: "/assessment" },
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "youth",
    name: "Youth",
    h1: "Youth Athletic Performance Training and Long-Term Development",
    description:
      "Youth athletic performance training in Tampa Bay and online: age-appropriate strength, movement quality and long-term development, by Darren J Paul, PhD.",
    hook: "Build the body. Build the patterns. Don't burn the athlete.",
    cardTagline: "Long-term athletic development, age-appropriate progression.",
    audienceType: "Elite and competitive youth athletes in long-term development",
    answerQuestion: "What is youth athletic performance training?",
    answer:
      "Youth athletic performance training is the long-term development of how a young athlete moves, produces force, decelerates and recovers, programmed around their developmental stage and training age rather than chronological age alone. The science is clear: properly supervised strength, speed and movement-quality work is one of the most effective injury-prevention tools available to young athletes. Generic adult programs and YouTube routines miss that completely. At DJP Athlete, youth athletes are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2). The Five Pillar Framework underpins every block: assessment, individualized programming, load monitoring, technical coaching and long-term athletic development. Younger athletes get a movement-quality and bodyweight-strength foundation; older youth athletes earn higher-intent loading and sport-specific transfer as they progress. Delivered in person at the Tampa Bay facility and through the speed-and-agility clinics for the local cohort.",
    qualities: [
      {
        title: "Age and stage-appropriate progression",
        body: "Load and intent scale with training age and maturity, not chronological age. Younger athletes earn movement quality before load; older youth athletes earn power before peak intent.",
      },
      {
        title: "Movement quality before everything",
        body: "Acceleration, deceleration, change of direction and rotational mechanics taught from the foundation. Strength is built around clean movement, not in spite of dirty movement.",
      },
      {
        title: "Injury prevention by design",
        body: "Anti-rotation control, posterior chain capacity, eccentric strength and balanced loading reduce the soft-tissue and joint injuries that derail young athletes. Programmed in, not bolted on.",
      },
      {
        title: "Long-term development, not eight-week peaks",
        body: "Plans look at the next two to four years. Peaking a 14-year-old for one tournament is the wrong question; building an athletic ceiling that holds through 18, 22, 26 is the right one.",
      },
    ],
    outcomes: [
      "Faster, cleaner movement that holds under fatigue",
      "Fewer overuse and growth-related complaints across a season",
      "Better posture, decel and change of direction visible to coaches",
      "A development plan parents can actually defend",
    ],
    faqs: [
      {
        question: "How young is too young?",
        answer:
          "Properly supervised athletic-development work is safe and appropriate for school-age athletes already in organized sport, with the right programming. The NSCA and major youth performance bodies endorse supervised strength, speed and movement-quality work for young athletes when it is age-appropriate.",
      },
      {
        question: "Is heavy lifting safe for young athletes?",
        answer:
          "Loaded work, programmed correctly, is one of the most effective injury-prevention tools available to young athletes. The key is the word programmed. We do not chase one-rep maxes with developing bodies. We build the pattern, load it appropriately, and progress when the athlete earns it.",
      },
      {
        question: "Will this affect their growth?",
        answer:
          "No. The concern about strength training stunting growth was retired by sports medicine decades ago. Appropriate progressions support, not stunt, healthy development. Single-sport overuse is a much greater risk than supervised strength work.",
      },
      {
        question: "Should they specialize in one sport?",
        answer:
          "Generally no, especially before the late teens. Multi-sport youth athletes have better long-term outcomes and fewer overuse injuries. Programming respects that and builds general athletic qualities that transfer across sports.",
      },
      {
        question: "How does this fit with their sport practice and team training?",
        answer:
          "Athletic development complements team practice and game play. Volume and load are managed to fit the calendar, with reductions in heavy weeks and competition periods. We coordinate transparently with school and club coaches where helpful.",
      },
      {
        question: "Where do youth sessions happen?",
        answer:
          "In person at our Zephyrhills, FL facility for the Tampa Bay area, plus speed and agility clinics in the local area. Online coaching is available for older youth athletes (typically high school and up) who are ready for remote programming.",
      },
    ],
    primaryCta: { label: "Apply for in-person coaching", href: "/in-person" },
    secondaryCta: { label: "See youth speed and agility clinics", href: "/clinics" },
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "return-to-sport",
    name: "Return to Sport",
    h1: "Return-to-Performance Coaching for Athletes Coming Back from Injury",
    description:
      "Return-to-performance coaching that bridges medical clearance and competition. Diagnostic-driven, asymmetry-targeted, by Darren J Paul, PhD (Tampa Bay and online).",
    hook: "Cleared is not the same as ready. We bridge the gap.",
    cardTagline: "Post-rehab to competition, asymmetry-targeted, reinjury-aware.",
    audienceType:
      "Athletes returning from injury or surgery who have been cleared by a clinician but are not yet competition-ready",
    answerQuestion: "What is return-to-performance coaching?",
    answer:
      "Return-to-performance coaching is the structured rebuild between medical clearance and competition readiness. Physios and surgeons restore tissue and clear an athlete to play. They do not, and usually cannot, restore the speed, power, asymmetry, reactive strength and sport-specific decision-making the athlete had before the injury. That gap is where most reinjuries happen, and where return-to-performance coaching lives. At DJP Athlete, the process starts with a return-to-performance assessment (force production, asymmetry, reactive strength, sport-specific movement) and an individualized program that closes the gap measured by data, not by feel. Coaching is by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2). The work runs alongside any physio or clinical team already involved, in-person at the Tampa Bay facility or online with weekly programming and video feedback. The standard is not cleared. The standard is ready.",
    qualities: [
      {
        title: "Return-to-performance assessment",
        body: "Force production, single-leg asymmetry, reactive strength, movement quality and sport-specific outputs measured before the rebuild starts. Clearance is the starting point, not the finish line.",
      },
      {
        title: "Asymmetry-targeted programming",
        body: "Single-leg force imbalances, posterior chain deficits and trunk control gaps get programmed directly, not hoped away. The data sets the priorities.",
      },
      {
        title: "Progressive reactive loading",
        body: "Static strength is rebuilt first, then plyometric capacity, then sport-specific reactive tasks. Reintegration is staged so each reload is earned, not assumed.",
      },
      {
        title: "Sport-specific reintegration",
        body: "Decision-making, change of direction at speed and competitive context are layered back in deliberately. Returning to play is one decision; returning to perform is a sequence.",
      },
    ],
    outcomes: [
      "Single-leg asymmetry restored to within accepted thresholds, measured not estimated",
      "Reactive strength and change of direction back to pre-injury levels",
      "Confidence to compete that matches the data, not the calendar",
      "Reduced reinjury risk through measured, progressive reintegration",
    ],
    faqs: [
      {
        question: "When should I start return-to-performance work?",
        answer:
          "As soon as your clinician clears you for progressive loading. Often this is alongside the tail end of physio, not after it. Starting earlier closes the asymmetry and reactive-strength gap before deconditioning compounds.",
      },
      {
        question: "Do I still need my physio?",
        answer:
          "Yes, until they discharge you. We are not a rehab program and we do not replace physio. We work alongside it, then take over once you are cleared for progressive loading, and we coordinate openly with the clinician.",
      },
      {
        question: "How is this different from physio?",
        answer:
          "Physio restores tissue and clears you to play. Return-to-performance restores the speed, power, asymmetry and reactive strength that decide whether you can perform at the level you played before. Different question, different toolset.",
      },
      {
        question: "What injuries do you work with?",
        answer:
          "Most lower-body and trunk injuries that affect athletic output: ACL, meniscus, ankle, hamstring, groin, low back, hip. Upper-body and rotational shoulder issues for throwing and racket athletes. Where surgery or specialist involvement is required, we coordinate.",
      },
      {
        question: "How long does return-to-performance take?",
        answer:
          "Depends on the injury, the athlete and the standard. A post-ACL rebuild to competition-ready is typically a structured block of three to six months on top of the rehab. Smaller injuries close in weeks. We test, we progress when criteria are met, we do not guess.",
      },
      {
        question: "Where do you deliver this?",
        answer:
          "In-person at our Zephyrhills, FL facility in the Tampa Bay area, and online worldwide. The return-to-performance assessment runs in person where possible; subsequent coaching can run either format with weekly programming and video review.",
      },
    ],
    primaryCta: { label: "Book a return-to-performance assessment", href: "/assessment" },
    secondaryCta: { label: "See how assessment works", href: "/assessment" },
  },
]

/** Lookup helper. */
export function getAthleteAudienceBySlug(slug: string): AthleteAudience | undefined {
  return ATHLETES.find((a) => a.slug === slug)
}
