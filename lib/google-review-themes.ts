/**
 * Google-extracted review themes from Darren J Paul Sports Performance GBP.
 *
 * These are the topic clusters Google's NLP surfaces as "chips" on the
 * Reviews tab of the GBP listing. They are customer-validated (every theme
 * is tied to N real reviews mentioning that topic) and represent how Google
 * itself associates this business with topics for ranking purposes.
 *
 * Source: GBP Place ID ChIJw5GXPKNN3YgRqvY7cRf1S8g
 *
 * UPDATE CADENCE: refresh every 30–60 days by visiting the GBP Reviews tab,
 * recording the theme chips + counts, and bumping the lastVerifiedAt date.
 *
 * The Places API (New) endpoint does NOT return these themes — they are
 * only visible in the Google Search Maps UI, so this is hand-curated data.
 */

export interface ReviewTheme {
  /** The theme phrase as Google labels it */
  label: string
  /** Number of reviews mentioning this theme */
  count: number
  /** Optional grouping for UI sorting / emphasis */
  category?: "outcome" | "method" | "trust" | "sport"
}

/** Last time the themes below were verified against the live GBP. */
export const REVIEW_THEMES_VERIFIED_AT = "2026-05-08"

/** Themes ordered by mention count (highest first). */
export const GBP_REVIEW_THEMES: ReviewTheme[] = [
  { label: "injury prevention", count: 12, category: "outcome" },
  { label: "strength training", count: 9, category: "method" },
  { label: "personalized approach", count: 8, category: "method" },
  { label: "knowledgeable coach", count: 7, category: "trust" },
  { label: "caring trainer", count: 4, category: "trust" },
  { label: "tailored workouts", count: 4, category: "method" },
  { label: "tennis performance", count: 3, category: "sport" },
  { label: "flexibility training", count: 3, category: "method" },
  { label: "knowledge of anatomy", count: 2, category: "trust" },
  { label: "speed training", count: 2, category: "method" },
]

/** Total reviews tied to themes (sum of counts; some reviews mention multiple). */
export const GBP_TOTAL_REVIEWS = 44
