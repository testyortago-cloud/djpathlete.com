// lib/brand/author.ts
// Single source of truth for the Person JSON-LD that appears on every blog
// post and (future) author page. Edit here, every consumer reflects it.
//
// Production URL is darrenjpaul.com (per project memory). Social links are
// the ones tied to the DJP Athlete brand. Update these with the actual
// canonical URLs when available.

export const DJP_AUTHOR_PERSON = {
  "@type": "Person" as const,
  name: "Darren J Paul",
  url: "https://www.darrenjpaul.com/about",
  jobTitle: "Strength & Conditioning Coach",
  image: "https://www.darrenjpaul.com/images/darren-headshot.jpg",
  sameAs: [
    "https://www.instagram.com/djpathlete",
    "https://www.linkedin.com/in/darren-paul",
    "https://www.youtube.com/@djpathlete",
  ],
}
