import type { TourStep } from "@/types/tour"

// ─── ExerciseFormDialog ──────────────────────────────────────────────────────

export function getExerciseTourSteps(expandAiSection: () => void): TourStep[] {
  return [
    {
      target: "name",
      title: "Exercise Name",
      description:
        "The display name clients see in their program. Use a clear, recognizable name like \"Barbell Back Squat\" or \"Dumbbell Lateral Raise\".",
    },
    {
      target: "category",
      title: "Category",
      description:
        "Tag the exercise with one or more categories. Tap a chip to toggle it. This affects which exercises appear when filtering by type (Strength, Cardio, etc.).",
    },
    {
      target: "difficulty",
      title: "Difficulty Level",
      description:
        "Helps the AI pick age- and experience-appropriate exercises when building programs. Beginner = basic movements, Advanced = complex/heavy lifts.",
    },
    {
      target: "muscle_group",
      title: "Muscle Group (Display)",
      description:
        "A short label shown on exercise cards and lists (e.g. \"Chest & Triceps\"). This is just for quick visual reference — the AI uses Primary Muscles below for matching.",
    },
    {
      target: "equipment",
      title: "Equipment (Display)",
      description:
        "Quick label for the equipment needed (e.g. \"Barbell, Squat Rack\"). Shown on exercise cards. For AI-powered equipment matching, use the Equipment Required chips in the AI section.",
    },
    {
      target: "description",
      title: "Description",
      description:
        "A brief summary of what the exercise is and what it targets. Clients see this when they tap on an exercise for details.",
    },
    {
      target: "instructions",
      title: "Instructions",
      description:
        "Step-by-step coaching cues. Clients see these during their workout. Be specific — e.g. \"Brace your core, lower until thighs are parallel, drive through your heels.\"",
    },
    {
      target: "video_url",
      title: "Video URL",
      description:
        "Paste a YouTube link to show clients a demo video. The preview thumbnail appears on exercise cards and the full video plays in the exercise detail view.",
    },
    {
      target: "movement_pattern",
      title: "Movement Pattern (AI)",
      description:
        "Tells the AI what type of movement this is (push, pull, squat, hinge, etc.). Used to ensure programs are balanced — e.g. not all push with no pull.",
      beforeShow: expandAiSection,
    },
    {
      target: "force_type",
      title: "Force Type (AI)",
      description:
        "Whether the exercise primarily involves pushing, pulling, or holding (static/dynamic). Helps the AI balance program structure.",
      beforeShow: expandAiSection,
    },
    {
      target: "laterality",
      title: "Laterality (AI)",
      description:
        "Bilateral = both sides at once (back squat), Unilateral = one side (single-leg RDL), Alternating = switching sides. The AI uses this to add variety and address imbalances.",
      beforeShow: expandAiSection,
    },
    {
      target: "primary_muscles",
      title: "Primary Muscles (AI)",
      description:
        "The main muscles this exercise works. Tap to select — e.g. Quadriceps and Glutes for a squat. The AI uses these to balance muscle groups across a program and find suitable alternatives.",
      beforeShow: expandAiSection,
    },
    {
      target: "secondary_muscles",
      title: "Secondary Muscles (AI)",
      description:
        "Muscles that assist during the movement but aren't the primary target — e.g. Core and Calves during a squat. Helps the AI understand total training volume per muscle.",
      beforeShow: expandAiSection,
    },
    {
      target: "equipment_required",
      title: "Equipment Required (AI)",
      description:
        "Select all equipment needed for this exercise. The AI uses this to only pick exercises the client has access to, based on their questionnaire answers.",
      beforeShow: expandAiSection,
    },
    {
      target: "bodyweight_compound",
      title: "Bodyweight & Compound (AI)",
      description:
        "Bodyweight = no equipment needed (push-ups, lunges). Compound = uses multiple joints (squats, deadlifts) vs. Isolation = single joint (bicep curls). Helps the AI structure workout order.",
      beforeShow: expandAiSection,
    },
    {
      target: "exercise-relationships",
      title: "Relationships",
      description:
        "Link related exercises together. Progressions = harder variants, Regressions = easier variants, Alternatives = similar exercises, Variations = different forms. The AI uses these to suggest swaps and build progression paths.",
    },
  ]
}

// ─── ProgramFormDialog ───────────────────────────────────────────────────────

export const PROGRAM_TOUR_STEPS: TourStep[] = [
  {
    target: "name",
    title: "Program Name",
    description:
      "The name clients see when they view their assigned program. Make it descriptive — e.g. \"12-Week Strength Builder\" or \"Off-Season Rugby Conditioning\".",
  },
  {
    target: "category",
    title: "Category",
    description:
      "What type of program this is. Strength = lifting-focused, Conditioning = cardio/endurance, Hybrid = mix of both. Used for filtering and analytics.",
  },
  {
    target: "difficulty",
    title: "Difficulty",
    description:
      "The intended skill level. Helps you filter programs and ensures clients are matched to appropriate difficulty. Elite = competitive athletes.",
  },
  {
    target: "split_type",
    title: "Split Type",
    description:
      "How training days are organized. Full Body = every muscle each session, Upper/Lower = alternating, Push/Pull/Legs = three-day rotation. Leave as None if unsure.",
  },
  {
    target: "periodization",
    title: "Periodization",
    description:
      "How intensity changes over weeks. Linear = gradually increases, Undulating = varies day-to-day, Block = focused phases. Leave as None for straightforward programs.",
  },
  {
    target: "duration_weeks",
    title: "Duration (Weeks)",
    description:
      "How many weeks the program runs. Common ranges: 4-6 for a training block, 8-12 for a full cycle, 16+ for long-term periodization.",
  },
  {
    target: "sessions_per_week",
    title: "Sessions per Week",
    description:
      "How many training days per week. This determines how many day slots appear in the program builder. Typical range: 2-6 depending on the client.",
  },
  {
    target: "price_dollars",
    title: "Price",
    description:
      "How much to charge for this program (in dollars). Leave blank for programs included in a membership. Stripe integration is coming soon.",
  },
  {
    target: "description",
    title: "Description",
    description:
      "A summary of the program's goals and approach. Clients see this on the program overview page. Keep it motivating and informative.",
  },
]

// ─── AddExerciseDialog (step 2 — configure) ─────────────────────────────────

export const ADD_EXERCISE_TOUR_STEPS: TourStep[] = [
  {
    target: "sets",
    title: "Sets",
    description:
      "How many sets the client should perform. This is the number of times they repeat the exercise with rest in between. e.g. 3 sets of 10 reps.",
  },
  {
    target: "reps",
    title: "Reps",
    description:
      "How many repetitions per set. Can be a number (10) or a range (8-12). For timed exercises like planks, use the Duration field instead.",
  },
  {
    target: "rest_seconds",
    title: "Rest (Seconds)",
    description:
      "How long to rest between sets, in seconds. Typical: 30-60s for endurance, 60-90s for hypertrophy, 2-5 minutes for heavy strength work.",
  },
  {
    target: "duration_seconds",
    title: "Duration (Seconds)",
    description:
      "How long to hold or perform the exercise, in seconds. Used for timed exercises like planks, wall sits, or cardio intervals instead of reps.",
  },
  {
    target: "rpe_target",
    title: "RPE Target",
    description:
      "Rate of Perceived Exertion on a 1-10 scale. 7 = could do 3 more reps, 9 = could do 1 more, 10 = absolute max. Helps clients gauge effort without exact weights.",
  },
  {
    target: "intensity_pct",
    title: "Intensity (%1RM)",
    description:
      "Percentage of the client's one-rep max. e.g. 75% means they use 75% of the heaviest weight they can lift once. Only relevant for strength exercises with known maxes.",
  },
  {
    target: "tempo",
    title: "Tempo",
    description:
      "Controls the speed of each rep phase. Format: eccentric-pause-concentric-pause (e.g. 3-1-2-0 = 3s lowering, 1s pause, 2s lifting, 0s at top). Increases time under tension.",
  },
  {
    target: "group_tag",
    title: "Group Tag (Supersets)",
    description:
      "Use the same letter to group exercises done back-to-back. A1 + A2 = superset (2 exercises), B1 + B2 + B3 = tri-set. Leave blank for normal straight sets.",
  },
  {
    target: "notes",
    title: "Notes",
    description:
      "Any extra coaching cues or modifications for this specific slot — e.g. \"Use slow eccentric\" or \"Increase weight from last week.\" Clients see this during their workout.",
  },
]

// ─── EditExerciseDialog ──────────────────────────────────────────────────────

export const EDIT_EXERCISE_TOUR_STEPS: TourStep[] = [
  {
    target: "edit-sets",
    title: "Sets",
    description:
      "How many sets the client should perform. This is the number of times they repeat the exercise with rest in between. e.g. 3 sets of 10 reps.",
  },
  {
    target: "edit-reps",
    title: "Reps",
    description:
      "How many repetitions per set. Can be a number (10) or a range (8-12). For timed exercises like planks, use the Duration field instead.",
  },
  {
    target: "edit-rest",
    title: "Rest (Seconds)",
    description:
      "How long to rest between sets, in seconds. Typical: 30-60s for endurance, 60-90s for hypertrophy, 2-5 minutes for heavy strength work.",
  },
  {
    target: "edit-duration",
    title: "Duration (Seconds)",
    description:
      "How long to hold or perform the exercise, in seconds. Used for timed exercises like planks, wall sits, or cardio intervals instead of reps.",
  },
  {
    target: "edit-rpe",
    title: "RPE Target",
    description:
      "Rate of Perceived Exertion on a 1-10 scale. 7 = could do 3 more reps, 9 = could do 1 more, 10 = absolute max. Helps clients gauge effort without exact weights.",
  },
  {
    target: "edit-intensity",
    title: "Intensity (%1RM)",
    description:
      "Percentage of the client's one-rep max. e.g. 75% means they use 75% of the heaviest weight they can lift once. Only relevant for strength exercises with known maxes.",
  },
  {
    target: "edit-tempo",
    title: "Tempo",
    description:
      "Controls the speed of each rep phase. Format: eccentric-pause-concentric-pause (e.g. 3-1-2-0 = 3s lowering, 1s pause, 2s lifting, 0s at top). Increases time under tension.",
  },
  {
    target: "edit-group-tag",
    title: "Group Tag (Supersets)",
    description:
      "Use the same letter to group exercises done back-to-back. A1 + A2 = superset (2 exercises), B1 + B2 + B3 = tri-set. Leave blank for normal straight sets.",
  },
  {
    target: "edit-notes",
    title: "Notes",
    description:
      "Any extra coaching cues or modifications for this specific slot — e.g. \"Use slow eccentric\" or \"Increase weight from last week.\" Clients see this during their workout.",
  },
]

// ─── AssignProgramDialog ─────────────────────────────────────────────────────

export const ASSIGN_PROGRAM_TOUR_STEPS: TourStep[] = [
  {
    target: "user_id",
    title: "Client",
    description:
      "Pick which client gets this program. They'll see it in their app immediately after assignment. Each client can have multiple programs but only one active at a time.",
  },
  {
    target: "start_date",
    title: "Start Date",
    description:
      "When the program begins. Week 1 / Day 1 starts on this date. The app auto-calculates which week and day the client should be on based on this.",
  },
  {
    target: "assign-notes",
    title: "Notes",
    description:
      "Internal notes about this assignment — e.g. \"Returning from injury, start light\" or \"Replacing previous program.\" Only visible to you, not the client.",
  },
]

// ─── AddClientDialog ─────────────────────────────────────────────────────────

export const ADD_CLIENT_TOUR_STEPS: TourStep[] = [
  {
    target: "firstName",
    title: "First Name",
    description:
      "The client's first name. Used in their profile, welcome email, and throughout the app. This is how Coach DJP will address them.",
  },
  {
    target: "lastName",
    title: "Last Name",
    description:
      "The client's last name. Combined with first name for their full profile display.",
  },
  {
    target: "email",
    title: "Email",
    description:
      "Their email address — used for login. They'll receive a welcome email with a temporary password at this address. Make sure it's correct.",
  },
  {
    target: "phone",
    title: "Phone",
    description:
      "Optional phone number for contact purposes. Not used for login or notifications currently.",
  },
]

// ─── EditClientDialog ────────────────────────────────────────────────────────

export const EDIT_CLIENT_TOUR_STEPS: TourStep[] = [
  {
    target: "edit-firstName",
    title: "First Name",
    description:
      "The client's first name. Used in their profile, emails, and throughout the app. This is how Coach DJP will address them.",
  },
  {
    target: "edit-lastName",
    title: "Last Name",
    description:
      "The client's last name. Combined with first name for their full profile display.",
  },
  {
    target: "edit-email",
    title: "Email",
    description:
      "Their login email address. Changing this updates the email they use to sign in. Make sure the new email is correct — there's no re-verification yet.",
  },
  {
    target: "edit-phone",
    title: "Phone",
    description:
      "Optional phone number for contact purposes. Not used for login or notifications currently.",
  },
  {
    target: "edit-status",
    title: "Status",
    description:
      "Active = can log in and use the app. Inactive = account disabled, can't log in. Suspended = temporarily blocked. Changing to inactive or suspended immediately locks them out.",
  },
]

// ─── ImportGoogleReviewDialog ────────────────────────────────────────────────

export const IMPORT_REVIEW_TOUR_STEPS: TourStep[] = [
  {
    target: "reviewer_name",
    title: "Reviewer Name",
    description:
      "The name of the person who left the Google review. Displayed on your website's testimonial section exactly as entered here.",
  },
  {
    target: "review-rating",
    title: "Rating",
    description:
      "How many stars (1-5) the reviewer gave. Click the stars to set the rating. This shows as star icons on the testimonial cards on your site.",
  },
  {
    target: "comment",
    title: "Comment",
    description:
      "The actual review text. This is the testimonial quote displayed on your website. Leave blank if the reviewer only left a star rating.",
  },
  {
    target: "review_date",
    title: "Review Date",
    description:
      "When the review was originally posted on Google. Used for sorting reviews chronologically on your site.",
  },
]

// ─── AiGenerateDialog ────────────────────────────────────────────────────────

export const AI_GENERATE_TOUR_STEPS: TourStep[] = [
  {
    target: "ai-client",
    title: "Client",
    description:
      "Select which client this program is for. If they've completed their questionnaire, their preferences (goals, schedule, equipment) will auto-fill the fields below.",
  },
  {
    target: "ai-goals",
    title: "Goals",
    description:
      "What the client wants to achieve — strength, hypertrophy, fat loss, etc. Select one or more. Auto-filled from their questionnaire if available. The AI tailors exercise selection and rep ranges to match.",
  },
  {
    target: "ai-duration",
    title: "Duration (Weeks)",
    description:
      "How long the AI program should run. 4 weeks is a standard training block. The AI structures progressive overload across this timeframe.",
  },
  {
    target: "ai-sessions",
    title: "Sessions per Week",
    description:
      "How many days per week the client will train. Auto-filled from their questionnaire if available. The AI designs the split based on this number.",
  },
  {
    target: "ai-minutes",
    title: "Session Length",
    description:
      "How long each workout should take. The AI adjusts exercise count and rest periods to fit within this time. Auto-filled from the client's questionnaire.",
  },
  {
    target: "ai-split",
    title: "Split Type",
    description:
      "How training days are organized. Leave as \"Auto\" to let the AI choose the best split based on sessions/week and goals. Override if you have a specific preference.",
  },
  {
    target: "ai-periodization",
    title: "Periodization",
    description:
      "How intensity and volume change over weeks. Linear = gradual increase, Undulating = daily variation, Block = focused phases. Leave as \"Auto\" to let the AI decide.",
  },
  {
    target: "ai-instructions",
    title: "Additional Instructions",
    description:
      "Free-text notes for the AI — e.g. \"Focus on posterior chain\", \"Include sprint work\", or \"Avoid overhead pressing due to shoulder issues.\" This directly influences exercise selection.",
  },
]
