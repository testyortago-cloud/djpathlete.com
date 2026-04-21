// lib/platform-setup-guides.ts
// Short, non-developer-facing setup guides rendered inline on the Platform
// Connections page. Two flavors per plugin: "I don't have an account yet"
// and "I have one — just connect." Kept intentionally terse — the Phase 6
// handoff Loom video covers the longer walkthrough.

import type { SocialPlatform } from "@/types/database"

export interface SetupGuide {
  accountSetupMinutes: number
  accountSetupSteps: string[]
  connectSteps: string[]
  scopesGranted: string[]
  helpUrl?: string
}

export const PLATFORM_SETUP_GUIDES: Record<SocialPlatform, SetupGuide> = {
  facebook: {
    accountSetupMinutes: 15,
    accountSetupSteps: [
      "Create (or use) a Facebook account with admin rights.",
      "Go to facebook.com/pages/create — pick the Business category and fill in the Page name + category.",
      "Upload a profile photo (your logo) and a cover image. Skip the rest; you can finish later.",
      "From the Page, click Settings → Page Roles and confirm you're listed as Admin.",
    ],
    connectSteps: [
      "Click Connect on this row.",
      "A Facebook popup asks you to grant DJP Athlete access to your Page. Select the Page, then Allow.",
      "Once the popup closes, the badge flips to Connected. You're done.",
    ],
    scopesGranted: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    helpUrl: "https://www.facebook.com/help/104002523024878",
  },
  instagram: {
    accountSetupMinutes: 5,
    accountSetupSteps: [
      "You need a Facebook Page first — connect Facebook above if you haven't.",
      "Open Instagram → Profile → Edit profile → Switch to Professional Account → Business.",
      "When prompted to link a Facebook Page, pick the Page from the Facebook step.",
    ],
    connectSteps: [
      "Click Connect on this row.",
      "The same Facebook OAuth popup appears — Instagram is served through the Meta Graph API.",
      "Grant Instagram Business permissions and pick the linked IG account.",
    ],
    scopesGranted: ["instagram_basic", "instagram_content_publish", "pages_read_engagement"],
    helpUrl: "https://help.instagram.com/502981923235522",
  },
  tiktok: {
    accountSetupMinutes: 10,
    accountSetupSteps: [
      "Install TikTok on your phone and sign up (email or Apple sign-in is fastest).",
      "Tap Profile → Manage account → Switch to Business account → pick the Fitness category.",
      "Fill in display name + bio — this is what viewers see.",
    ],
    connectSteps: [
      "Click Connect on this row.",
      "TikTok OAuth opens in a new tab. Log in, grant Content Posting permissions, tap Authorize.",
      "TikTok's API is hybrid: scheduled posts trigger a push notification to your phone with the caption + video link pre-filled. Tap Share to finish publishing.",
    ],
    scopesGranted: ["video.publish", "user.info.basic"],
    helpUrl: "https://support.tiktok.com/en/business-and-creator/business-account",
  },
  youtube: {
    accountSetupMinutes: 10,
    accountSetupSteps: [
      "Sign in to the Google account you want to host the channel under.",
      "Go to youtube.com → click your avatar → Create a channel.",
      "Pick a channel name (your own or a brand name — you can change it later).",
      "Add a profile image and channel banner when prompted, or skip for now.",
    ],
    connectSteps: [
      "Click Connect on this row.",
      "Google OAuth opens in a new tab. Sign in to the account that owns the channel.",
      "Grant the YouTube Data API permissions (upload videos, read analytics).",
    ],
    scopesGranted: ["youtube.upload", "youtube.readonly"],
    helpUrl: "https://support.google.com/youtube/answer/1646861",
  },
  youtube_shorts: {
    accountSetupMinutes: 0,
    accountSetupSteps: [
      "YouTube Shorts uses the same channel as long-form YouTube — no separate account.",
      "Set up the YouTube plugin above first. Shorts publishes to the same channel, just as vertical clips under 60 seconds.",
    ],
    connectSteps: [
      "YouTube Shorts shares credentials with the YouTube plugin.",
      "Connecting YouTube auto-enables this row. Nothing extra needed.",
    ],
    scopesGranted: ["youtube.upload", "youtube.readonly"],
    helpUrl: "https://support.google.com/youtube/answer/10059070",
  },
  linkedin: {
    accountSetupMinutes: 20,
    accountSetupSteps: [
      "Sign in to LinkedIn with your personal profile (you need one to create a Company Page).",
      "Click Work → Create a Company Page → Company. Fill in name, website, size, industry.",
      "Upload a logo and cover image.",
      "LinkedIn requires you to verify you can represent the company — usually an email ping. Complete that before connecting here.",
    ],
    connectSteps: [
      "Click Connect on this row.",
      "LinkedIn OAuth opens. Sign in and pick the Company Page you just created.",
      "Grant the w_organization_social and r_organization_social scopes.",
    ],
    scopesGranted: ["w_organization_social", "r_organization_social"],
    helpUrl: "https://www.linkedin.com/help/linkedin/answer/710",
  },
}
