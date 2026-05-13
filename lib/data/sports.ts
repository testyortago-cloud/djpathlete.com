/**
 * Sport-specific landing-page content. Each entry produces a page at
 * /sports/{slug} via the dynamic route, and a card on the /sports hub.
 * Keep the copy on-brand: distinctive, anti-fluff, no em-dashes.
 *
 * `relatedProgramSlug` links the page to a /programs/* asset where a
 * matching product exists. `qualities` are the 4 sport-specific outputs
 * we train (these become the visible "What we develop" grid).
 */
export interface SportFaq {
  question: string
  answer: string
}

export interface SportQuality {
  title: string
  body: string
}

export interface Sport {
  /** URL slug. Final URL: /sports/{slug} */
  slug: string
  /** Display name, used in nav + cards + breadcrumbs. */
  name: string
  /** Visible H1. Carries the primary keyword. */
  h1: string
  /** Page meta description, kept under 155 chars. */
  description: string
  /** Hero hook line (under H1). One sentence, brand voice. */
  hook: string
  /** Short tagline used on the hub card. */
  cardTagline: string
  /** Question for the SemanticAnswerBlock. */
  answerQuestion: string
  /** 134–167 word self-contained answer (the AI-extractable block). */
  answer: string
  /** Four sport-specific qualities we develop. */
  qualities: [SportQuality, SportQuality, SportQuality, SportQuality]
  /** What 12 weeks of work realistically delivers (used in the "What changes" section). */
  outcomes: string[]
  /** Six FAQ entries. Reads as real text and feeds FAQPage JSON-LD. */
  faqs: SportFaq[]
  /** Slug of a related /programs/* page, if one exists. */
  relatedProgramSlug?: string
  /** Pull-quote testimonial (athlete level, anonymised or named). */
  testimonialQuote?: { quote: string; attribution: string }
}

export const SPORTS: Sport[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "tennis-performance-training",
    name: "Tennis",
    h1: "Tennis Performance Training, Built by a Coach Who Trains WTA Pros",
    description:
      "Tennis performance training in Tampa Bay and online. Acceleration, deceleration, late-set conditioning and rotational power, programmed by Darren J Paul, PhD.",
    hook: "Your second serve depends on what your hips can do at minute 90.",
    cardTagline: "Acceleration, deceleration, late-set conditioning, rotational power.",
    answerQuestion: "What is tennis performance training?",
    answer:
      "Tennis performance training is the structured development of how a player accelerates, decelerates, redirects, rotates and recovers, programmed around the demands of a real match rather than general fitness. Most amateur tennis training defaults to running and core work. That misses what actually wins points: short repeated sprints, fast change of direction off both legs, a rotational chain that produces racket-head speed, and conditioning that holds up in three-set matches. At DJP Athlete, tennis players are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), who has worked with WTA professionals as part of 500+ athletes coached across 15+ sports. Training happens in two formats: in-person in Tampa Bay (Zephyrhills, FL), and online for traveling players, with weekly programming, video feedback and ongoing oversight. The same five-pillar framework runs both: assessment, individualized programming, load monitoring, technical coaching and long-term development.",
    qualities: [
      {
        title: "First-step acceleration",
        body: "Get to the ball faster off both legs, off split-step, and out of awkward stances. Trained with short-distance starts, resisted accelerations and reactive starts.",
      },
      {
        title: "Deceleration and redirection",
        body: "The skill that decides defensive points. Trained with eccentric strength, single-leg landings and lateral cuts that hold up under fatigue.",
      },
      {
        title: "Rotational power",
        body: "Where racket-head speed actually comes from. Trained with the kinetic chain from the floor up: anti-rotation control, rotational strength, rotational throws.",
      },
      {
        title: "Late-set conditioning",
        body: "Repeated-sprint capacity that lets you play the third set the way you played the first. Trained with sport-specific intervals, not steady-state running.",
      },
    ],
    outcomes: [
      "Faster first step to wide balls and short balls",
      "Cleaner deceleration with less stress on knees and hips",
      "More racket-head speed on serve and forehand",
      "Three-set capacity without the second-set drop",
    ],
    faqs: [
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
    relatedProgramSlug: "rotational-reboot",
    testimonialQuote: {
      quote:
        "What sets him apart is how much he genuinely cares about you as a person first. The Online Program is so easy to navigate and thoroughly explains how to perform the exercises.",
      attribution: "Abigail Rencheli, WTA Professional Tennis Player",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "golf-performance-training",
    name: "Golf",
    h1: "Golf Performance Training: More Clubhead Speed, Fewer Layups",
    description:
      "Golf performance training built around rotation, anti-rotation and ground reaction force. Tampa Bay and online, by Darren J Paul, PhD (CSCS, NASM, USAW Level 2).",
    hook: "You cannot out-swing a body that does not rotate.",
    cardTagline: "Clubhead speed, rotational power, distance without injury.",
    answerQuestion: "What is golf performance training?",
    answer:
      "Golf performance training is the structured development of the physical qualities that drive clubhead speed and protect the back, hips and shoulders across a season. The swing is a rotational power event delivered through the ground in well under a second. That asks for hip mobility, thoracic rotation, anti-rotation core control, sequenced rotational power and the eccentric strength to absorb the finish. At DJP Athlete, golfers are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), who programs the work around the player's actual swing demands rather than a generic gym template. The work runs in-person at the Tampa Bay facility or online with weekly programming and video feedback. The same five-pillar framework underpins every block: assessment, individualized programming, load monitoring, technical coaching and long-term development. The aim is straightforward: more clubhead speed, fewer compensations, fewer rounds lost to injury.",
    qualities: [
      {
        title: "Rotational power",
        body: "Built bottom-up from the ground, the back hip and the trunk. Trained with rotational throws, cable chops and progressively heavier rotational lifts.",
      },
      {
        title: "Anti-rotation control",
        body: "The other side of rotation: the strength to resist losing posture mid-swing. Trained with Pallof presses, side planks and rollouts.",
      },
      {
        title: "Hip and thoracic mobility",
        body: "Range of motion at the joints the swing actually needs. Trained as part of warm-up and recovery, not as filler stretching.",
      },
      {
        title: "Eccentric strength and durability",
        body: "The capacity to brake hard at the finish and play 18 holes without back fatigue. Trained with controlled eccentric squats, RDLs and single-leg work.",
      },
    ],
    outcomes: [
      "Higher clubhead speed off the tee",
      "Better posture and sequencing under pressure",
      "Less back fatigue across 18 holes",
      "Fewer rounds lost to lower-back and hip flare-ups",
    ],
    faqs: [
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
    relatedProgramSlug: "rotational-reboot",
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "baseball-performance-training",
    name: "Baseball",
    h1: "Baseball Performance Training, Built Around Rotation",
    description:
      "Baseball performance training in Tampa Bay and online. Rotational power, exit velocity, throwing velocity, sprint speed and arm-care durability, by Darren J Paul, PhD.",
    hook: "Bat speed is built in the back hip, not the back room.",
    cardTagline: "Exit velocity, throwing velocity, sprint speed, arm-care durability.",
    answerQuestion: "What is baseball performance training?",
    answer:
      "Baseball performance training is the structured development of the physical qualities that drive exit velocity, throwing velocity, base-running speed and durability over a long season. Hitting and throwing are both rotational power events delivered through the ground. That asks for force production, a sequenced kinetic chain, anti-rotation core control, deceleration to brake the finish, and arm-care work that keeps the shoulder healthy under repeated high-output reps. At DJP Athlete, baseball players are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), who programs the work around the player's position, level and current outputs. Training runs in-person at the Tampa Bay facility or online with weekly programming and video feedback. The five-pillar framework guides every block: assessment, individualized programming, load monitoring, technical coaching and long-term development. The goal is consistent: more output, fewer injuries, more games available.",
    qualities: [
      {
        title: "Rotational power for exit velocity",
        body: "Trained from the ground up: anti-rotation control before rotational strength, rotational strength before rotational power. Med-ball throws and rotational lifts at speed.",
      },
      {
        title: "Throwing velocity and arm care",
        body: "Posterior shoulder strength, scapular control and rotator-cuff endurance, programmed alongside lower-body and trunk power. The arm is the last link in the chain.",
      },
      {
        title: "Base-running speed and acceleration",
        body: "Short-distance starts, change of direction off the base, and the reactive starts that decide steals. Sprint mechanics coached, not assumed.",
      },
      {
        title: "Eccentric strength and durability",
        body: "The capacity to decelerate hard and stay healthy across a long season. Single-leg eccentrics, posterior chain strength and deliberate in-season programming.",
      },
    ],
    outcomes: [
      "Measurable bumps in exit velocity through a properly periodized block",
      "More throwing velocity with less shoulder fatigue",
      "Faster home-to-first and reactive jumps off the base",
      "More games available across the season",
    ],
    faqs: [
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
    relatedProgramSlug: "rotational-reboot",
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "soccer-performance-training",
    name: "Soccer",
    h1: "Soccer Performance Training: Acceleration, Deceleration, Decisions",
    description:
      "Soccer performance training in Tampa Bay and online. Acceleration, deceleration, repeated-sprint capacity and reactive agility, by Darren J Paul, PhD.",
    hook: "The game rewards the second sprint, not the first.",
    cardTagline: "Acceleration, deceleration, repeated-sprint capacity, reactive agility.",
    answerQuestion: "What is soccer performance training?",
    answer:
      "Soccer performance training is the structured development of the physical qualities that decide outcomes inside 90 minutes of football: short repeated sprints, hard decelerations, change of direction off both legs, reactive agility and the conditioning that keeps the second half looking like the first. It is not a generic running program. It is built around how the game is actually played, with the same five-pillar framework that runs every DJP Athlete program: assessment, individualized programming, load monitoring, technical coaching and long-term development. At DJP Athlete, soccer players are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2). Training runs in-person at the Tampa Bay facility or online with weekly programming and video feedback. Two-week pre-season and off-season blocks are also available at our high-performance soccer camps. The aim is straightforward: be sharper in the moments that decide games and more available across the season.",
    qualities: [
      {
        title: "Acceleration and short-sprint speed",
        body: "The 5 to 15 metre bursts that decide most football actions. Trained with resisted starts, sprint mechanics work and reactive starts off both feet.",
      },
      {
        title: "Deceleration and change of direction",
        body: "Brake hard, redirect off either leg, and live to do it again. Trained with eccentric strength, single-leg landings and lateral cuts.",
      },
      {
        title: "Repeated-sprint capacity",
        body: "The capacity to make the second and third sprint, not just the first. Trained with sport-specific intervals built around match demands.",
      },
      {
        title: "Reactive agility and decision speed",
        body: "Read, react, move. Trained with reactive drills that pair stimulus and decision-making with the physical pattern.",
      },
    ],
    outcomes: [
      "Faster first three steps in tight space",
      "Cleaner deceleration with less knee and hip stress",
      "More high-intensity actions per match without the second-half drop",
      "Sharper change of direction off the weaker leg",
    ],
    faqs: [
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
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "lacrosse-performance-training",
    name: "Lacrosse",
    h1: "Lacrosse Performance Training: Stick Speed Starts in the Hips",
    description:
      "Lacrosse performance training in Tampa Bay and online. Acceleration, deceleration, rotational power for shooting, and dodge-and-redirect agility, by Darren J Paul, PhD.",
    hook: "Your shot is only as fast as the floor you can drive into.",
    cardTagline: "Acceleration, dodge agility, rotational power, repeated-sprint capacity.",
    answerQuestion: "What is lacrosse performance training?",
    answer:
      "Lacrosse performance training is the structured development of how a player accelerates, decelerates, dodges, shoots and recovers across a high-tempo game. Like tennis and baseball, the lacrosse shot is a rotational power event delivered through the ground in well under a second. The game itself is a series of short sprints, hard cuts and repeated efforts under contact. That asks for force production, anti-rotation control, sequenced rotational power, eccentric capacity to absorb cuts, and repeated-sprint conditioning. At DJP Athlete, lacrosse players are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), with the same five-pillar framework that underpins every program: assessment, individualized programming, load monitoring, technical coaching and long-term development. Training runs in-person at the Tampa Bay facility or online with weekly programming and video feedback. The aim is straightforward: better shot output, sharper dodges, more reps available across a long season.",
    qualities: [
      {
        title: "Rotational power for shooting",
        body: "Built from the ground up: anti-rotation before rotation, strength before speed. Medicine-ball work and rotational lifts develop the chain the shot rides on.",
      },
      {
        title: "Acceleration and dodge agility",
        body: "Short repeated bursts and sharp change of direction off either leg, trained with resisted starts, lateral cuts and reactive starts under stimulus.",
      },
      {
        title: "Eccentric strength and contact durability",
        body: "Brake hard, absorb contact, and stay healthy. Single-leg eccentrics, posterior chain strength and deliberate in-season programming.",
      },
      {
        title: "Repeated-sprint capacity",
        body: "Sport-specific intervals built around the actual demands of a lacrosse game, not steady-state running. Stay sharp in the fourth quarter.",
      },
    ],
    outcomes: [
      "More shot velocity off the dominant and weak hand",
      "Sharper first step on dodges",
      "Cleaner deceleration off cuts and pickups",
      "Better availability across a contact season",
    ],
    faqs: [
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
    relatedProgramSlug: "rotational-reboot",
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: "pickleball-performance-training",
    name: "Pickleball",
    h1: "Pickleball Performance Training: Move Better, Last Longer",
    description:
      "Pickleball performance training for serious players. Lateral speed, deceleration, rotational power and durability, by Darren J Paul, PhD (Tampa Bay and online).",
    hook: "The game rewards calmness under fatigue. We build both.",
    cardTagline: "Lateral speed, deceleration, rotational power, joint durability.",
    answerQuestion: "What is pickleball performance training?",
    answer:
      "Pickleball performance training is the structured development of how a player moves, produces force, decelerates and recovers across a high-volume game. Pickleball asks for short lateral starts, hard decelerations in tight space, rotational power on the punch volley and drive, and joint-level durability through hours of repetition. Most amateur pickleball players never train any of it, then get injured by the same hard cut, the same overstretched lunge or the same sore shoulder. At DJP Athlete, pickleball players are coached by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), who has worked with professional pickleball players among 500+ athletes across 15+ sports. Training runs in-person at the Tampa Bay facility or online, with weekly programming and video feedback. The same five-pillar framework underpins every block: assessment, individualized programming, load monitoring, technical coaching and long-term development. The aim is straightforward: move better, last longer, stay in the game.",
    qualities: [
      {
        title: "Lateral acceleration and deceleration",
        body: "Quick lateral starts and the eccentric strength to brake without overloading the knee. Trained with short-distance starts, single-leg landings and lateral cuts.",
      },
      {
        title: "Rotational power",
        body: "Where punch-volley speed and drive pace come from. Trained from the ground up: anti-rotation, rotational strength, then rotational power.",
      },
      {
        title: "Hip and shoulder mobility",
        body: "Range at the joints that take the volume of pickleball. Programmed as warm-up, movement prep and recovery, not as filler stretching.",
      },
      {
        title: "Joint durability and recovery",
        body: "The unglamorous work that lets you play three days a week without paying for it. Eccentric strength, posterior chain work and structured recovery.",
      },
    ],
    outcomes: [
      "Sharper lateral first step in tight space",
      "Less knee and hip soreness after long sessions",
      "More pace on punch volleys and drives",
      "Fewer down days through high-volume weeks",
    ],
    faqs: [
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
          "Yes. The online program is built around your weekly schedule and the equipment you have. Weekly programming, video feedback and ongoing oversight, the same five-pillar framework we run in person.",
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
    testimonialQuote: {
      quote:
        "Darren understands performance & injury prevention at a very high level. The Online program is seamless and allows me to train from anywhere.",
      attribution: "Tina Pisnik, Professional Pickleball Player",
    },
  },
]

/** Lookup helpers. */
export function getSportBySlug(slug: string): Sport | undefined {
  return SPORTS.find((s) => s.slug === slug)
}
