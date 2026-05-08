/**
 * Single source of truth for NAP (Name / Address / Phone) and Google Business Profile.
 * Reuse across LocalBusiness JSON-LD, footer, contact page, and any local-SEO surface.
 */

export const BUSINESS_INFO = {
  legalName: "Darren J Paul Sports Performance",
  brand: "DJP Athlete",

  address: {
    streetAddress: "6585 Simons Rd",
    addressLocality: "Zephyrhills",
    addressRegion: "FL",
    postalCode: "33541",
    addressCountry: "US",
  },

  // Tampa Bay region — used for `areaServed` and local-SEO targeting.
  serviceAreas: ["Zephyrhills, FL", "Tampa, FL", "Wesley Chapel, FL", "Lakeland, FL", "Tampa Bay Area"],

  // Public Google Business Profile identifiers — safe to commit; the API key stays in env.
  googlePlaceId: "ChIJw5GXPKNN3YgRqvY7cRf1S8g",
} as const

export const GOOGLE_MAPS_URL = `https://www.google.com/maps/place/?q=place_id:${BUSINESS_INFO.googlePlaceId}`

export const formattedAddress = [
  BUSINESS_INFO.address.streetAddress,
  `${BUSINESS_INFO.address.addressLocality}, ${BUSINESS_INFO.address.addressRegion} ${BUSINESS_INFO.address.postalCode}`,
  "USA",
].join(", ")

export const postalAddressSchema = {
  "@type": "PostalAddress",
  streetAddress: BUSINESS_INFO.address.streetAddress,
  addressLocality: BUSINESS_INFO.address.addressLocality,
  addressRegion: BUSINESS_INFO.address.addressRegion,
  postalCode: BUSINESS_INFO.address.postalCode,
  addressCountry: BUSINESS_INFO.address.addressCountry,
} as const
