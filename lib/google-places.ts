import { unstable_cache } from "next/cache"
import { BUSINESS_INFO } from "@/lib/business-info"

export interface GooglePlaceReview {
  authorName: string
  authorPhotoUrl: string | null
  rating: number
  text: string
  relativeTimeDescription: string
  publishTime: string
  reviewUrl: string | null
}

export interface GoogleBusinessProfile {
  rating: number
  userRatingCount: number
  reviews: GooglePlaceReview[]
  googleMapsUri: string | null
  displayName: string | null
}

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places"
const FIELD_MASK = [
  "id",
  "displayName",
  "rating",
  "userRatingCount",
  "googleMapsUri",
  "reviews.name",
  "reviews.rating",
  "reviews.text",
  "reviews.originalText",
  "reviews.relativePublishTimeDescription",
  "reviews.publishTime",
  "reviews.authorAttribution",
].join(",")

async function fetchPlace(placeId: string, apiKey: string): Promise<GoogleBusinessProfile | null> {
  const res = await fetch(`${PLACES_ENDPOINT}/${placeId}?languageCode=en`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    next: { revalidate: 21600 },
  })

  if (!res.ok) return null

  const data = (await res.json()) as {
    displayName?: { text?: string }
    rating?: number
    userRatingCount?: number
    googleMapsUri?: string
    reviews?: Array<{
      rating?: number
      text?: { text?: string }
      originalText?: { text?: string }
      relativePublishTimeDescription?: string
      publishTime?: string
      authorAttribution?: { displayName?: string; photoUri?: string; uri?: string }
    }>
  }

  const reviews: GooglePlaceReview[] = (data.reviews ?? []).map((r) => ({
    authorName: r.authorAttribution?.displayName ?? "Google reviewer",
    authorPhotoUrl: r.authorAttribution?.photoUri ?? null,
    rating: r.rating ?? 5,
    text: r.text?.text ?? r.originalText?.text ?? "",
    relativeTimeDescription: r.relativePublishTimeDescription ?? "",
    publishTime: r.publishTime ?? "",
    reviewUrl: r.authorAttribution?.uri ?? null,
  }))

  return {
    rating: data.rating ?? 0,
    userRatingCount: data.userRatingCount ?? 0,
    reviews,
    googleMapsUri: data.googleMapsUri ?? null,
    displayName: data.displayName?.text ?? null,
  }
}

export const getGoogleBusinessProfile = unstable_cache(
  async (): Promise<GoogleBusinessProfile | null> => {
    // Place ID falls back to the business-info constant; the API key MUST come from env.
    const placeId = process.env.GOOGLE_BUSINESS_PLACE_ID || BUSINESS_INFO.googlePlaceId
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!placeId || !apiKey) return null
    try {
      return await fetchPlace(placeId, apiKey)
    } catch {
      return null
    }
  },
  ["google-business-profile"],
  { revalidate: 21600, tags: ["google-business-profile"] },
)
