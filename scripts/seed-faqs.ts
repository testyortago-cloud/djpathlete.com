// Seed script — FAQ CMS
//
// Seeds the `faqs` table (00158) with the FAQs currently hardcoded across the
// marketing site, so existing pages keep their FAQs once they switch to the DB.
//
// Idempotent: before seeding a page_key, checks listFaqsForPage(). If the page
// already has rows, it is skipped. Safe to re-run.
//
// Run: npx tsx scripts/seed-faqs.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { createFaq, listFaqsForPage } from "@/lib/db/faqs"

type SeedFaq = {
  page_key: string
  category: string | null
  question: string
  answer: string
  link_text: string | null
  link_href: string | null
}

// ─── /faq — category-grouped ────────────────────────────────────────────────

const faqPage: SeedFaq[] = [
  // About DJP Athlete
  {
    page_key: "faq",
    category: "About DJP Athlete",
    question: "What is DJP Athlete?",
    answer:
      "DJP Athlete is the practitioner brand of Darren J Paul, PhD — a sports performance coach based in Zephyrhills, Florida (Tampa Bay area). We provide three coaching services for serious athletes: in-person performance coaching, online performance coaching, and return-to-performance testing & assessment. Every program is built from diagnostic data — movement quality, force, load tolerance, sport demands — and adjusted weekly based on wellness markers and video review. The brand is positioned in deliberate contrast to template-based or self-service training apps. Online coaching is application-only and selective.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "About DJP Athlete",
    question: "Who is Darren J Paul?",
    answer:
      "Darren J Paul, PhD is a sports performance coach, performance strategist, and researcher with two decades inside high-performance environments. He has coached 500+ athletes across 15+ sports and 3 continents — including WTA professional tennis players and pro pickleball players. Certifications: CSCS (NSCA) and NASM Certified Personal Trainer. He holds a B.S. in Exercise Science & Kinesiology and a PhD.",
    link_text: "Read full bio",
    link_href: "/about",
  },
  {
    page_key: "faq",
    category: "About DJP Athlete",
    question: "Who is DJP Athlete coaching for?",
    answer:
      "DJP Athlete works with serious athletes at four tiers: (1) competitive athletes at high school, collegiate, semi-professional, and professional levels; (2) elite youth athletes in long-term development; (3) post-injury athletes who are medically cleared but not yet competition-ready (return-to-performance); (4) high-performing professionals who train with athletic intent. We do not work with recreational fitness clients, weight-loss-focused individuals, or athletes seeking template-based programming. Entry to online coaching is selective and application-only.",
    link_text: null,
    link_href: null,
  },
  // Online Coaching
  {
    page_key: "faq",
    category: "Online Coaching",
    question: "How is online coaching with DJP Athlete different from other online coaching?",
    answer:
      "Most online coaching delivers a spreadsheet and a check-in form. Our system is diagnostic-driven. Every program is built from a remote movement, force, and load assessment, then adjusted weekly through video review, daily wellness data, and direct messaging with the coach. It is the same methodology used in person at our Zephyrhills, FL office — adapted for remote delivery without compromising quality. Coaching does not stop the moment the program goes out; it continues through every session via video review and load adjustments. Entry is selective and application-only.",
    link_text: "Apply for online coaching",
    link_href: "/online#apply",
  },
  {
    page_key: "faq",
    category: "Online Coaching",
    question: "What does a typical week of online coaching look like?",
    answer:
      "A week includes structured programming tailored to your current training phase, regular coaching check-ins, and video reviews of key sessions. You receive detailed feedback on movement quality, load management adjustments based on wellness data, and direct communication with your coach as needed. Daily wellness logging (HRV, sleep, sRPE) feeds load decisions. Programs are adjusted in real time when readiness markers drop or competition demands shift. Every week is planned with intent — not generic blocks pulled from a template library.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Online Coaching",
    question: "What equipment do I need for online coaching?",
    answer:
      "Equipment requirements vary by sport and training goals. At minimum, access to a well-equipped gym with free weights, a squat rack, and basic conditioning tools is recommended. Specific requirements are discussed during the assessment process and programming is adapted to your available environment. We work with athletes training in commercial gyms, university weight rooms, hotel gyms while traveling, and home setups. The methodology adapts to the equipment, not the other way around.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Online Coaching",
    question: "How do I get started with online coaching?",
    answer:
      "The process begins with an application. If accepted, you complete a comprehensive remote assessment covering movement quality, training history, sport demands, and performance goals. From there, a strategic plan (the Performance Blueprint) is built and your coaching begins. Entry is selective to ensure every athlete receives the attention they deserve. Application reviews complete within 48 hours.",
    link_text: "Apply now",
    link_href: "/online#apply",
  },
  // In-Person Coaching (Tampa Bay)
  {
    page_key: "faq",
    category: "In-Person Coaching (Tampa Bay)",
    question: "Where is DJP Athlete's in-person coaching located?",
    answer:
      "In-person coaching is delivered at Darren J Paul Sports Performance, 6585 Simons Rd, Zephyrhills, FL 33541, in the Tampa Bay area of Florida. The facility serves athletes from across Tampa Bay, including Tampa, Wesley Chapel, Lakeland, Brandon, and Riverview. Drive times: ~35 minutes from downtown Tampa, ~20 minutes from Wesley Chapel, ~30 minutes from Lakeland.",
    link_text: "Get directions",
    link_href: "/contact",
  },
  {
    page_key: "faq",
    category: "In-Person Coaching (Tampa Bay)",
    question: "Who is in-person coaching for?",
    answer:
      "In-person coaching serves four primary athlete types: competitive athletes (high school, collegiate, semi-professional, professional), elite youth athletes in long-term development, post-injury return-to-performance athletes, and high-performing professionals. It is not entry-level training and not generic group fitness. Capacity is limited to protect coaching quality. Programming is individually designed; sessions are coach-led and assessment-driven. Each athlete starts with a comprehensive performance assessment that informs every subsequent training decision.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "In-Person Coaching (Tampa Bay)",
    question: "What sports do you coach?",
    answer:
      "Across 20+ years, DJP Athlete has worked with athletes in 15+ sports including tennis, pickleball, soccer, golf, track and field, basketball, football, rugby, and combat sports. The methodology is sport-agnostic — the diagnostic process identifies the qualities each sport demands, and programming is built around those demands. Whether the athlete needs explosive change-of-direction, repeated-sprint capacity, rotational power, or impact tolerance, the system identifies and develops it.",
    link_text: null,
    link_href: null,
  },
  // Return-to-Performance Assessment
  {
    page_key: "faq",
    category: "Return-to-Performance Assessment",
    question: "What is return-to-performance training?",
    answer:
      "Return-to-performance training is the bridge between medical clearance and competition readiness. It restores capacity, reintegrates speed and power, and rebuilds confidence to compete. Distinct from rehab — which ends at clearance — return-to-performance ends when an athlete is verifiably ready to compete at full intensity. The phase is where most reinjuries happen because clinical milestones do not equal competition readiness. We assess strength, force production, asymmetry, reactive ability, and sport-specific power to identify and close the gap before return.",
    link_text: "See the assessment process",
    link_href: "/assessment",
  },
  {
    page_key: "faq",
    category: "Return-to-Performance Assessment",
    question: "What's the difference between rehab and return-to-performance?",
    answer:
      "Rehab is clinical: it restores baseline function under the supervision of a physiotherapist or surgeon. Discharge means the tissue has healed and the athlete meets minimum return-to-activity criteria. Return-to-performance is athletic: it asks whether the athlete can perform at competition intensity without compensation, asymmetry, or unaddressed risk. Cleared is not the same as ready. Most reinjuries happen in this gap because no one is testing for it specifically. We collaborate with physiotherapists, surgeons, and team performance staff — additive to clinical care, not replacement.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Return-to-Performance Assessment",
    question: "What does a return-to-performance assessment include?",
    answer:
      "A comprehensive assessment includes force-platform testing (ground reaction force, peak output, left/right asymmetry under load), motion capture analysis (joint angles, control, compensation patterns), load monitoring (cumulative training load vs recovery), speed timing (acceleration, top-end, deceleration), reactive testing (decision-making under cued and open-environment stimulus), and power diagnostics (watts, rate of force development across movement planes). Outcomes: a performance profile, identified asymmetries, defined risk gaps, a return progression plan, and evidence-backed competitive confidence.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Return-to-Performance Assessment",
    question: "Who do you collaborate with on return-to-performance cases?",
    answer:
      "We work alongside physiotherapists, surgeons, sports medicine physicians, athletic trainers, and team performance staff. The assessment process is designed to slot into existing care pathways — informing the next phase, not replacing prior steps. Many of our return-to-performance athletes come to us via referral from their physio or surgeon when the athlete is medically cleared but not match-fit. We respect clinical boundaries and provide reports clinicians can use.",
    link_text: null,
    link_href: null,
  },
  // Pricing & Logistics
  {
    page_key: "faq",
    category: "Pricing & Logistics",
    question: "How much does sports performance coaching cost?",
    answer:
      "Online coaching pricing is shared after application review. Pricing depends on coaching depth (touchpoints per week, video review frequency, in-person testing access). In-person coaching at our Zephyrhills, FL facility is custom-priced based on session frequency and program length. Return-to-performance assessment is priced as a standalone diagnostic with optional follow-on programming. We do not price-shop against $20–30/month training apps; that is not the same product. We do offer a free 15-minute consultation to determine fit.",
    link_text: "Book a free consultation",
    link_href: "/contact",
  },
  {
    page_key: "faq",
    category: "Pricing & Logistics",
    question: "How long does it take to see results?",
    answer:
      "Measurable strength and capacity changes typically appear within 4–6 weeks of consistent training. Sport-specific outcomes (speed, power, confidence) follow within 8–12 weeks, with major performance gains across a full training block of 12–16 weeks. Return-to-performance timelines depend on the injury and starting capacity — for example, post-ACL athletes typically need 9–12 months from surgery to confident competition return, with the final 3–6 months being the performance-rebuild phase. We track outcomes against measurable benchmarks, not vague feelings.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Pricing & Logistics",
    question: "Why is entry selective?",
    answer:
      "Capacity is intentionally limited so every athlete receives the depth of coaching attention the methodology requires. We accept athletes we can genuinely help — those whose goals, timelines, and circumstances fit the supervised, assessment-driven approach. Athletes seeking automated workouts, generic programming, or cosmetic-fitness goals are not a fit and are better served by other products at lower price points. Selective entry is mutual: it protects the coaching standard for athletes we accept, and it saves time for those who would not benefit.",
    link_text: null,
    link_href: null,
  },
  // Youth Athletes & Parents
  {
    page_key: "faq",
    category: "Youth Athletes & Parents",
    question: "Is strength training safe for my child?",
    answer:
      "Yes — when supervised by a properly certified coach, with age-appropriate programming and proper technique instruction. The National Strength and Conditioning Association (NSCA) and American Academy of Pediatrics both endorse supervised resistance training for youth. The risk profile is lower than most youth sports themselves. The conditions: a coach with the right certification (CSCS, NSCA-CPT, or equivalent), structured progression, and a focus on movement quality before load. We meet those conditions.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Youth Athletes & Parents",
    question: "Will lifting weights stunt my child's growth?",
    answer:
      "No. The 'stunted growth' concern is a long-standing myth not supported by current research. Properly supervised resistance training does not damage growth plates or stunt height in healthy youth athletes. Injuries to growth plates in young athletes occur far more often in unsupervised settings, with poor technique under maximal loads, or in untrained sport-specific impacts — not in supervised, age-appropriate strength programs.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Youth Athletes & Parents",
    question: "What age should kids start strength training?",
    answer:
      "Children can begin learning fundamental movement patterns (squatting, hinging, pushing, pulling, bracing) as soon as they can follow simple instructions and demonstrate consistent technique — typically age 7–8 with bodyweight movements. External load (light dumbbells, kettlebells, or empty barbells with proper coaching) is generally introduced around age 11–13 for most children, depending on physical and emotional maturity. The right starting age depends more on coachability and supervision quality than chronological age.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Youth Athletes & Parents",
    question: "What questions should I ask a youth strength coach before signing up my child?",
    answer:
      "Ask: (1) What certification do you hold? CSCS or equivalent is the standard. (2) What is your coach-to-athlete ratio? Smaller is better; 1:8–1:12 is reasonable for group work. (3) Will you coordinate with my child's sport coach and physiotherapist if needed? (4) Are parents allowed to watch sessions? Refusal is a red flag. (5) How do you progress an athlete from beginner to advanced? Listen for a structured answer with a long-term arc, not 'we just push them harder.'",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Youth Athletes & Parents",
    question: "Will strength training help prevent sport injuries in my young athlete?",
    answer:
      "Yes — the evidence is consistent across sport-injury prevention research. Supervised, well-programmed strength training meaningfully reduces the risk of common youth-sport injuries, particularly non-contact lower-body injuries (ACL, hamstring, ankle) and overuse injuries. The mechanism is improved force-absorption, joint stability, and tissue tolerance. Strength training is one of the most effective injury-prevention tools available to youth athletes — when delivered correctly.",
    link_text: null,
    link_href: null,
  },
  // Comparing Coaching Options
  {
    page_key: "faq",
    category: "Comparing Coaching Options",
    question: "Are sports performance coaches worth it?",
    answer:
      "For serious athletes — competitive, return-to-sport, elite youth, high-performing professionals — yes, when the goal is performance development rather than general fitness. The value is in the coach's ability to read context: cutting volume when wellness markers drop, swapping movements based on observed technique, and progressing the athlete on data rather than assumption. For lifestyle fitness goals, a quality training app is often the better product at a fraction of the cost. The right answer depends on the athlete's goal.",
    link_text: "Compare coaching vs apps",
    link_href: "/services/coaching-vs-training-app",
  },
  {
    page_key: "faq",
    category: "Comparing Coaching Options",
    question: "What's the difference between a sports performance coach and a personal trainer?",
    answer:
      "A personal trainer is generalist-fitness-focused: weight management, general strength, lifestyle health. A sports performance coach is athletic-output-focused: speed, power, capacity, sport-specific qualities, and post-injury return to competition. The certifications differ (CSCS and NSCA are sport-performance credentials; CPT-style certifications cover general fitness). The programming differs (sport-specific demand modeling vs general body-comp goals). At DJP Athlete, the focus is sport performance, not fitness.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Comparing Coaching Options",
    question: "How do I find a good sports performance coach?",
    answer:
      "Look for: (1) Industry-standard certifications — CSCS (NSCA) or NASM; (2) Documented experience with athletes at your level or above; (3) An assessment-driven process, not template-based programming; (4) Clear communication about how decisions get made (e.g., what changes when wellness markers drop); (5) Willingness to coordinate with your physio, sport coach, or team performance staff; (6) A selective intake process — coaches who take everyone usually don't deliver to anyone in particular.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Comparing Coaching Options",
    question: "Do online sports performance programs actually work?",
    answer:
      "When the program is genuinely individualized, monitored continuously, and built by a credentialed coach with sport-specific expertise — yes. Online performance coaching delivers near-equivalent outcomes to in-person work for most athletes outside the coach's geographic region, provided the athlete has gym access, engages with daily wellness logging, and uploads weekly video. The format is structurally a better fit than in-person for touring professionals and traveling athletes whose schedules disqualify regular on-site sessions. Generic, template-based 'online programs' are a different product.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "faq",
    category: "Comparing Coaching Options",
    question: "When can I return to sport after an ACL injury?",
    answer:
      "Most athletes need 9–12 months from surgical reconstruction to confident competition return — significantly longer than the 'medically cleared' point at 6 months. The final 3–6 months is the return-to-performance phase: restoring force production, eliminating asymmetry, rebuilding reactive ability, and verifying readiness against sport-specific demands. Returning at 6 months because the surgeon cleared you is one of the highest-risk decisions an athlete can make. The right answer is when objective testing — not the calendar — shows readiness.",
    link_text: "See the assessment process",
    link_href: "/assessment",
  },
]

// ─── /online ────────────────────────────────────────────────────────────────

const onlinePage: SeedFaq[] = [
  {
    page_key: "online",
    category: null,
    question: "How is this different from other online coaching?",
    answer:
      "Most online coaching delivers a spreadsheet and a check-in form. This system is diagnostic-driven. Every program is built from assessment data, adjusted through continuous monitoring, and refined with direct coaching feedback. It is the same methodology used in person — adapted for remote delivery without compromising quality.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "online",
    category: null,
    question: "What does a typical week look like?",
    answer:
      "Your week includes structured programming tailored to your current phase, regular coaching check-ins, and video reviews of key sessions. You will receive detailed feedback on movement quality, load management adjustments based on wellness data, and direct communication with your coach as needed. Every week is planned with intention.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "online",
    category: null,
    question: "How do I get started?",
    answer:
      "The process begins with an application. If accepted, you will complete a comprehensive remote assessment covering movement quality, training history, sport demands, and performance goals. From there, a strategic plan is built and your coaching begins. Entry is selective to ensure every athlete receives the attention they deserve.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "online",
    category: null,
    question: "What equipment do I need?",
    answer:
      "Equipment requirements vary by sport and training goals. At minimum, access to a well-equipped gym with free weights, a squat rack, and basic conditioning tools is recommended. Specific requirements will be discussed during the assessment process and programming is adapted to your available environment.",
    link_text: null,
    link_href: null,
  },
]

// ─── /services/online-vs-in-person ──────────────────────────────────────────

const onlineVsInPersonPage: SeedFaq[] = [
  {
    page_key: "services/online-vs-in-person",
    category: null,
    question: "Is online sports performance coaching as effective as in-person?",
    answer:
      "For most athletes outside the Tampa Bay area, online coaching delivers near-equivalent outcomes when the athlete has access to a well-equipped gym and engages with the wellness logging, video review, and weekly programming. The methodology — diagnostic-driven, individually programmed, continuously adjusted — is identical between the two formats. In-person is preferred when real-time cueing, on-site instrumentation (force plates, sprint timing), or post-injury supervision is the deciding factor. For touring professionals or athletes whose schedules disqualify regular in-person sessions, online is structurally a better fit than splitting time.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/online-vs-in-person",
    category: null,
    question: "Can I switch from online to in-person (or vice versa)?",
    answer:
      "Yes. Athletes regularly start in one format and shift to the other based on life or competitive circumstances — for example, an athlete moving back to Florida for an off-season block, or a touring athlete starting in-person and transitioning to online when the season begins. The Performance Blueprint travels across formats; the underlying assessment data, programming history, and coaching relationship continue uninterrupted.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/online-vs-in-person",
    category: null,
    question: "Which is better for return-to-performance after surgery?",
    answer:
      "In-person is structurally preferred for the early-to-mid return-to-performance phase because instrumented testing (force plates, motion capture, reactive testing) and hands-on supervision close the gap from medical clearance to competition readiness most efficiently. Online return-to-performance work is possible later in the phase, when the athlete is past the highest-risk window and has access to a credible local clinician for in-person retesting milestones.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/online-vs-in-person",
    category: null,
    question: "Do online and in-person athletes train differently?",
    answer:
      "Within the same Performance Blueprint, no — the program structure, exercise selection logic, autoregulation rules, and coaching feedback follow the same approach. Differences are operational: online athletes log wellness daily and submit weekly video, in-person athletes are observed live. The output of either path is the same: an athlete with measurable, durable performance qualities who knows what they can trust under competition stress.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/online-vs-in-person",
    category: null,
    question: "Which is more expensive?",
    answer:
      "In-person and online have different cost structures. Pricing is shared after application review and depends on coaching depth, frequency, and program length. We do not benchmark against $20–30/month training apps; the work is structurally different. A free 15-minute consultation determines fit before any commitment.",
    link_text: null,
    link_href: null,
  },
]

// ─── /services/coaching-vs-training-app ─────────────────────────────────────

const coachingVsAppPage: SeedFaq[] = [
  {
    page_key: "services/coaching-vs-training-app",
    category: null,
    question: "Is sports performance coaching worth it over a $30/month app?",
    answer:
      "It depends on the athlete's goal. For lifestyle fitness, an app is often enough — and is the right product. For performance development, return-to-performance after injury, or sport-specific preparation, an app is structurally not the same product as supervised coaching. Apps deliver a workout. Coaching delivers an adjusted, individualized plan with weekly video review, daily wellness-driven decisions, and direct messaging with the coach who built it. The cost difference reflects the work difference, not the brand difference.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/coaching-vs-training-app",
    category: null,
    question: "Will I get the same results from a training app as from a coach?",
    answer:
      "For general fitness goals, modern training apps can drive meaningful results. For performance goals — measurable strength, speed, power, capacity gains tied to a sport or competition — supervised coaching outperforms because programming responds to your actual data (sleep, HRV, sRPE, video review). An app cannot cut volume on the day your HRV drops 9% or substitute a movement when the coach sees a knee valgus collapse on rep 3. A coach can.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/coaching-vs-training-app",
    category: null,
    question: "Why does coach-supervised coaching cost more than apps?",
    answer:
      "Different product. Apps charge for software access; the marginal cost of one more user is near zero. Supervised coaching charges for the coach's time — a coach who reviews your video each week, reads your wellness data daily, builds and adjusts your specific program, and answers your messages directly. We do not benchmark price against apps because the work being delivered is structurally different.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/coaching-vs-training-app",
    category: null,
    question: "Can I use both a coach and a training app?",
    answer:
      "Most of our athletes do — but not for the same purpose. Apps are useful as logging tools, for cardio prescriptions, or for travel-day fallback when the gym situation is uncertain. The coaching program is the source of truth for programming and progression. We integrate with whatever tracking tools the athlete already uses (Whoop, Garmin, AppleHealth, sRPE diaries) without forcing a single platform.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "services/coaching-vs-training-app",
    category: null,
    question: "When is a training app the right choice?",
    answer:
      "When the athlete's goal is general fitness, weight loss, or unstructured strength training and budget is the deciding factor. When there is no injury history that requires programming care. When the athlete does not need sport-specific qualities developed. When self-discipline and consistency are the primary obstacles, not programming quality. In those cases, a quality app is the right product and we will tell you so.",
    link_text: null,
    link_href: null,
  },
]

// ─── /athletes (hub) ────────────────────────────────────────────────────────

const athletesHubPage: SeedFaq[] = [
  {
    page_key: "athletes",
    category: null,
    question: "What athletes do you train?",
    answer:
      "Four stages: professional athletes (touring pros across rotational and racquet sports), collegiate and competitive amateur athletes, youth athletes in long-term athletic development, and athletes returning from injury who have been cleared by a clinician but are not yet competition-ready. The same coaching approach runs each stage, scaled to training age, sport and calendar.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "athletes",
    category: null,
    question: "Is strength training safe for young athletes?",
    answer:
      "Yes, when supervised and age-appropriate. The National Strength and Conditioning Association's position is that properly designed and supervised youth resistance training is safe, effective and beneficial. It does not stunt growth. Programmed correctly, it is one of the most effective injury-prevention tools available to young athletes.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "athletes",
    category: null,
    question: "How long after an ACL reconstruction can I return to sport?",
    answer:
      "Research published in the Journal of Orthopaedic & Sports Physical Therapy (2020) shows that returning to level-1 cutting and pivoting sport before 9 months after ACL reconstruction is associated with roughly a 7-fold higher rate of a second ACL injury. Each month of delay beyond that reduces reinjury risk by approximately 51 percent. Return-to-performance training runs alongside that timeline, not against it.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "athletes",
    category: null,
    question: "Should youth athletes specialize in one sport early?",
    answer:
      "Generally no. The 2016 American Orthopaedic Society for Sports Medicine consensus on early sport specialization concluded there is no evidence that early specialization benefits young athletes in the majority of sports, and that it is associated with increased overuse injury and burnout. Multi-sport participation through the early teens is the better long-term path.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "athletes",
    category: null,
    question: "Can a touring professional be trained remotely?",
    answer:
      "Yes. Online training is built around the realities of touring: travel, time zones, tournament density and the equipment available at the venue. Programming adjusts weekly to load and wellness markers, with video feedback and direct coach access. WTA professionals already train in this format.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "athletes",
    category: null,
    question: "How is sports performance training different from a personal trainer?",
    answer:
      "A personal trainer programs around general fitness. A sports performance coach programs around a sport — starting with diagnostics on force production, asymmetry, movement quality and sport-specific output, then building an individualized training plan that adjusts to load and wellness over time. Different goal, different toolset.",
    link_text: null,
    link_href: null,
  },
]

// ─── /programs/rotational-reboot ────────────────────────────────────────────

const rotationalRebootPage: SeedFaq[] = [
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "What is the Rotational Reboot program?",
    answer:
      "Rotational Reboot is a 6-week training program of 4 sessions per week (24 sessions in total) built to develop rotational power for athletes in rotational sports like tennis, golf, baseball, lacrosse, hockey and soccer. It's core-led (roughly 70% rotational core and trunk work, 30% supporting legs and arms) and runs a deliberate progression from beginner to moderate intensity, so you build control before speed. It was designed and programmed by Darren J Paul, PhD (CSCS, NASM).",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "What sports is it for?",
    answer:
      "Any sport where performance comes from rotating the body through the core and hips into the limbs: tennis, golf, baseball, softball, lacrosse, ice and field hockey, soccer, cricket, throwing events, boxing and MMA, volleyball, squash and padel. If your sport rewards a faster, better-sequenced rotation, this program is built for you.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "Do I need a gym?",
    answer:
      "A full gym makes it easiest, but the program is written to run on a basic home setup too. Most sessions need only a band or cable, a medicine ball, and a single dumbbell or kettlebell. Every exercise comes with a regression so you can scale it to your equipment without losing the point of the session.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "How much time does it take each week?",
    answer:
      "Four sessions a week, typically 40 to 55 minutes each, for six weeks. The sessions are built to be efficient (purposeful warm-up, the main rotational work, then supporting strength), so you're not living in the gym.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "Is it suitable for beginners?",
    answer:
      "Yes. The program starts at a beginner intensity and progresses to moderate over the six weeks; it never assumes you're already an advanced lifter. If you're more experienced, the built-in progressions let you load it appropriately. What it is not is a return-from-injury rehab plan; if you're working back from an injury, talk to Darren first.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "How is this different from a generic strength program?",
    answer:
      "Generic programs train the body in straight lines (push, pull, squat, hinge) and hope rotation shows up on its own. Rotational Reboot is built the other way round: it puts the core and the rotational pattern at the center, sequences anti-rotation control before rotational power, and progresses load and speed deliberately. It's the way rotational athletes are coached in high-performance environments, written down as a plan you can follow.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "How much is it?",
    answer:
      "$79, usually $249. One payment, lifetime access to the full 6-week program and every session, cue and demonstration inside it.",
    link_text: null,
    link_href: null,
  },
  {
    page_key: "programs/rotational-reboot",
    category: null,
    question: "Who built it?",
    answer:
      "Darren J Paul, PhD, is a sports performance coach with two decades inside high-performance environments, having coached 500+ athletes across 15+ sports including WTA professionals. Certifications: CSCS (NSCA) and NASM-CPT.",
    link_text: null,
    link_href: null,
  },
]

// ─── /sports/<slug> ─────────────────────────────────────────────────────────

const sportsFaqs: Record<string, { question: string; answer: string }[]> = {
  "tennis-performance-training": [
    {
      question: "Will lifting heavy slow down my serve?",
      answer:
        "No. Done right, strength work is the foundation of racket-head speed. The serve is a rotational power expression off the ground, and force production drives every link in the chain. We program for sport transfer, not for the gym leaderboard.",
    },
    {
      question: "How is this different from regular tennis fitness?",
      answer:
        "Most tennis fitness is running and core. Tennis performance training is structured around what tennis actually demands: short accelerations, hard decelerations, rotational power and late-set repeated-sprint capacity. Every block is built from a diagnostic of where you sit on each of those.",
    },
    {
      question: "Can you coach a touring player remotely?",
      answer:
        "Yes. The online program is built for athletes who travel. Programming adjusts week to week around your tournament schedule and the equipment available at the venue, with video feedback and ongoing coach oversight. WTA professionals already run this format.",
    },
    {
      question: "I'm coming back from a tennis injury. Should I start here?",
      answer:
        "Start with a return-to-performance assessment first. Once you have a clear picture of where you stand on force production, asymmetry, reactive strength and movement quality, tennis training plugs in. Cleared by a physio is not the same as ready for a match.",
    },
    {
      question: "What ages do you coach in tennis?",
      answer:
        "Competitive juniors through to professional players. Programs scale to age and training experience. Younger athletes get long-term athletic development as the foundation; older and elite players get higher-intent loading and sport-specific transfer.",
    },
    {
      question: "Where do in-person tennis sessions happen?",
      answer:
        "At our Zephyrhills, FL facility in the Tampa Bay area. Tampa, Wesley Chapel, Land O' Lakes, Lutz and Lakeland are all within reach. Online programs run worldwide.",
    },
  ],
  "golf-performance-training": [
    {
      question: "Can strength training mess up my swing?",
      answer:
        "No. Done right, it improves the swing by giving the body the range, control and force it needs to sequence properly. We program for golf transfer, not for the gym. If anything changes in the swing, it is usually a coach noticing better posture and a faster, calmer transition.",
    },
    {
      question: "How is this different from TPI?",
      answer:
        "TPI is a screen plus a coaching framework. Golf performance training is the year-round work that develops the qualities the screen reveals are missing. They are complementary. If you are already TPI-screened, share the results and we plug straight into them.",
    },
    {
      question: "Should I lift heavy in-season?",
      answer:
        "Yes, with the right programming. In-season blocks reduce volume but keep load high enough to maintain power. Detraining in-season is one of the most common ways amateur golfers lose distance through the year.",
    },
    {
      question: "I have a chronic back issue. Can I still train this way?",
      answer:
        "Almost always, yes. We start with an assessment, build anti-rotation and posterior chain capacity before chasing speed, and progress only when control is established. If a physio is involved, we coordinate.",
    },
    {
      question: "Does this work for older golfers?",
      answer:
        "It works particularly well for older golfers. Loss of clubhead speed with age is mostly a loss of strength and power, not a loss of skill. Bring back the strength and the speed comes with it.",
    },
    {
      question: "How long until I see clubhead speed gains?",
      answer:
        "Realistically four to eight weeks for measurable changes if you are training two to three times a week with sound programming. Bigger gains keep coming through six to twelve months as power output catches up to strength.",
    },
  ],
  "baseball-performance-training": [
    {
      question: "How is this different from velocity programs like Driveline?",
      answer:
        "Velocity programs are excellent at the throwing-specific side. Baseball performance training is the broader S&C foundation underneath: strength, power, mobility, deceleration and durability. The two work well together. If you are already in a velocity program, this layers in cleanly.",
    },
    {
      question: "Will lifting heavy hurt my arm?",
      answer:
        "Not with the right programming. Done well, lower-body and trunk strength reduces stress on the arm by improving how force is delivered through the body. Programming respects throwing volume and the season calendar.",
    },
    {
      question: "What ages do you train in baseball?",
      answer:
        "Competitive high-school players through to professional. Younger athletes get a long-term athletic development base; older and elite players get higher-intent loading and sport-specific transfer. Pre-season blocks tend to be the heaviest, in-season blocks the most disciplined.",
    },
    {
      question: "Do you work with pitchers, hitters or both?",
      answer:
        "Both, and they share more than people think. Pitching and hitting are both rotational power events. Programming changes around throwing volume and position-specific deceleration needs, but the underlying training principles are the same.",
    },
    {
      question: "I'm coming back from a UCL or shoulder issue. Can I start?",
      answer:
        "Start with a return-to-performance assessment first. Once we have a clear picture, training plugs in alongside any physio or throwing program already underway. We do not run a rehab program. We run the structured S&C work that makes return to play durable.",
    },
    {
      question: "In-person, online, or both?",
      answer:
        "Both work. In-person sessions happen at our Zephyrhills facility in the Tampa Bay area. Online programs run worldwide and are designed for the in-season travel realities of competitive baseball.",
    },
  ],
  "soccer-performance-training": [
    {
      question: "Does soccer fitness need a gym?",
      answer:
        "Some of the work, yes. Strength, power, eccentric capacity and durability are built with proper loading. The rest is field-based: sprint mechanics, reactive agility and conditioning. A complete soccer program uses both, sequenced so they support each other rather than fight.",
    },
    {
      question: "Will lifting make me slower?",
      answer:
        "No. The opposite. Force production is the foundation of acceleration, and stronger eccentric capacity lets you decelerate harder and redirect faster. We program for football transfer, not for gym totals.",
    },
    {
      question: "I'm a youth player. Am I too young to train like this?",
      answer:
        "No. Younger players get a long-term athletic development plan first: movement quality, coordination, sprint mechanics and bodyweight strength. Loading scales with training age and maturity, not chronological age alone.",
    },
    {
      question: "How does in-season programming work?",
      answer:
        "Reduced volume, maintained intent. Sessions are shorter and more focused, with strength and power kept at a high enough load to maintain output. Detraining in-season is one of the most common ways amateur players lose their late-season form.",
    },
    {
      question: "Do you run soccer-specific camps?",
      answer:
        "Yes. Off-season and pre-season high-performance soccer camps run in two-week blocks at our Tampa Bay facility. Camp blocks pair daily on-field work with structured strength, conditioning and recovery. See /camps for upcoming dates.",
    },
    {
      question: "Online or in-person for soccer players?",
      answer:
        "Both work. In-person training happens at our Zephyrhills, FL facility. Online programs are coach-led and built around your match calendar, with video feedback and weekly oversight. Most touring or college-based players combine the two across the year.",
    },
  ],
  "lacrosse-performance-training": [
    {
      question: "Will lifting heavy slow down my dodge?",
      answer:
        "No. Force production is the foundation of acceleration and change of direction. Programming respects sport demands and uses loading patterns that drive transfer, not hypertrophy for its own sake.",
    },
    {
      question: "What ages do you train in lacrosse?",
      answer:
        "Competitive high-school players through to elite college and beyond. Younger players get long-term athletic development as the base; older and elite players get higher-intent loading and position-specific transfer.",
    },
    {
      question: "How is this different from regular conditioning?",
      answer:
        "Generic conditioning runs steady-state. Lacrosse is repeated-sprint and reactive. The work is built around the game's actual physical pattern: short hard efforts, hard decelerations, recovery, repeat.",
    },
    {
      question: "Can you coach a player who is away at college?",
      answer:
        "Yes. The online program is built for athletes whose calendar moves. Weekly programming adjusts around team training, travel and games, with video feedback and ongoing coach oversight.",
    },
    {
      question: "I'm coming back from a hamstring or knee injury. Where do I start?",
      answer:
        "Start with a return-to-performance assessment first. Once we know where you stand on force production, asymmetry, reactive strength and movement quality, training plugs in cleanly alongside any physio still in play.",
    },
    {
      question: "In-person or online for lacrosse?",
      answer:
        "Both work. In-person sessions run at our Zephyrhills, FL facility in the Tampa Bay area. Online programs run worldwide and suit the realities of high-school and college lacrosse schedules.",
    },
  ],
  "pickleball-performance-training": [
    {
      question: "Is it worth strength training for pickleball?",
      answer:
        "Yes, more than people expect. The injury patterns in pickleball are repetitive and predictable, and almost all of them respond to strength and movement quality work. Players who train end up with fewer sore days, fewer down weeks and more pace on their shots.",
    },
    {
      question: "I'm in my fifties or sixties. Is this for me?",
      answer:
        "Particularly so. Loss of speed and power with age is mostly a loss of trained capacity. Bring back the eccentric strength, the lateral movement and the rotational power, and most players surprise themselves.",
    },
    {
      question: "How is this different from a personal trainer at the gym?",
      answer:
        "A personal trainer can get you fitter. A sports performance coach builds the qualities a sport actually rewards. The work here is designed around pickleball: how the game moves, what fails in players' bodies, and how to train to make those failures less likely.",
    },
    {
      question: "Can you coach pickleball players online?",
      answer:
        "Yes. The online program is built around your weekly schedule and the equipment you have. Weekly programming, video feedback and ongoing oversight, the same way we run things in person.",
    },
    {
      question: "I have a sore shoulder from too much pickleball. Where do I start?",
      answer:
        "Start with a return-to-performance assessment. Once we have a clear picture of where the shoulder, scapula and trunk are functioning, training plugs in. Where physio is needed, we work alongside it.",
    },
    {
      question: "Where are in-person sessions?",
      answer:
        "At our Zephyrhills, FL facility in the Tampa Bay area. Tampa, Wesley Chapel, Land O' Lakes, Lutz and Lakeland are all in easy reach. Online programs run worldwide.",
    },
  ],
}

// ─── /athletes/<slug> ───────────────────────────────────────────────────────

const athleteAudienceFaqs: Record<string, { question: string; answer: string }[]> = {
  professional: [
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
  collegiate: [
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
        "Any level, plus competitive amateurs outside the college system. The bar is intent, not status. The program scales with training age, not with division.",
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
  youth: [
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
  "return-to-sport": [
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
}

// ─── Assemble the full record set ───────────────────────────────────────────

function expandRecordMap(
  map: Record<string, { question: string; answer: string }[]>,
  prefix: string,
): SeedFaq[] {
  const out: SeedFaq[] = []
  for (const [slug, faqs] of Object.entries(map)) {
    for (const f of faqs) {
      out.push({
        page_key: `${prefix}/${slug}`,
        category: null,
        question: f.question,
        answer: f.answer,
        link_text: null,
        link_href: null,
      })
    }
  }
  return out
}

const allRecords: SeedFaq[] = [
  ...faqPage,
  ...onlinePage,
  ...onlineVsInPersonPage,
  ...coachingVsAppPage,
  ...athletesHubPage,
  ...rotationalRebootPage,
  ...expandRecordMap(sportsFaqs, "sports"),
  ...expandRecordMap(athleteAudienceFaqs, "athletes"),
]

// ─── Seed ───────────────────────────────────────────────────────────────────

async function seed() {
  console.log("📋 Seeding FAQ CMS from hardcoded site FAQs...\n")

  // Group records by page_key, preserving on-page order.
  const byPage = new Map<string, SeedFaq[]>()
  for (const rec of allRecords) {
    const list = byPage.get(rec.page_key) ?? []
    list.push(rec)
    byPage.set(rec.page_key, list)
  }

  let totalInserted = 0
  let totalSkipped = 0

  for (const [pageKey, records] of byPage) {
    const existing = await listFaqsForPage(pageKey)
    if (existing.length > 0) {
      console.log(`  ${pageKey}: skipped, already seeded (${existing.length} rows)`)
      totalSkipped += records.length
      continue
    }
    for (const rec of records) {
      await createFaq({ ...rec, status: "published" })
    }
    console.log(`  ${pageKey}: ${records.length} inserted`)
    totalInserted += records.length
  }

  console.log("\n═══════════════════════════════════════════════════════")
  console.log(`  Pages processed: ${byPage.size}`)
  console.log(`  FAQs inserted:   ${totalInserted}`)
  console.log(`  FAQs skipped:    ${totalSkipped}`)
  console.log("═══════════════════════════════════════════════════════")
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err.message)
  process.exit(1)
})
