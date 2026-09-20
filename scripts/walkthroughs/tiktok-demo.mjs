/**
 * TikTok App Review demo — the end-to-end integration, ~90 seconds.
 *
 * This show exists for ONE audience: a TikTok app reviewer checking that every
 * product and scope we request is actually used, and used the way we said.
 * So it is shot in the order they read the form:
 *
 *   Login Kit / user.info.basic  -> chapter 01, the linked account's handle
 *   Content Posting API          -> chapters 02-04, a real post
 *   video.publish + video.upload -> chapter 04, the upload and the post
 *
 * MUST BE RECORDED AGAINST PRODUCTION.
 *
 *   BASE_URL=https://www.darrenjpaul.com node scripts/record-walkthrough.mjs --show tiktok-demo
 *
 * TikTok's form says outright: "make sure the domain of the website shown in
 * the demo video matches the website URL you provide". That is
 * www.darrenjpaul.com. A localhost take fails review on the address bar alone,
 * however good the footage is. Production is also the only place a TikTok
 * account is actually linked (platform_connections.tiktok = connected,
 * darrenjpaul_), so it is the only place the end-to-end flow exists at all.
 *
 * AUTH. /api/dev/login is triple-gated and 404s whenever VERCEL is set, so it
 * cannot sign in here. The recorder must sign in through the real admin form
 * before the recorded page exists.
 *
 * PRIVACY — READ BEFORE RECORDING. defaultPrivacy() in lib/social/plugins/tiktok.ts
 * returns SELF_ONLY unless TIKTOK_PRIVACY_LEVEL is set, and TikTok forces
 * unaudited apps to private anyway, so the post this show makes is normally
 * PRIVATE to the account. If that env var has been set to PUBLIC_TO_EVERYONE,
 * this show publishes PUBLICLY to a real brand account. Check it first.
 *
 * DEMO_VIDEO_ID is the video the demo posts. It has to be one whose TikTok post
 * is still unpublished, or chapter 4 has no "Publish now" button to press.
 */

/**
 * Both ids are read LAZILY, through getters on the beats below.
 *
 * They cannot be validated at import time: prepare-walkthrough-media.mjs and
 * the Remotion config import this module purely for the chapter ids and their
 * order, and a throw up here took the staging step down with
 * "DEMO_VIDEO_ID is not set" long after the recording had finished. Only the
 * recorder ever reads a url or a click pattern, so only the recorder should
 * have to supply them.
 */
function requireEnv(name, hint) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. ${hint}`)
  return value
}

const videoUrl = () =>
  `/admin/content/${requireEnv(
    "DEMO_VIDEO_ID",
    "Pick a video whose TikTok post is still unpublished, or chapters 03 and 04 open a 404 instead of the video.",
  )}`

/**
 * The control that opens the TikTok post row.
 *
 * It has to be matched on its aria-label, and that is not a style preference.
 * The expander carries `aria-label="Expand post <id>"`, and an aria-label
 * REPLACES an element's accessible name — so the "TikTok" text, the status pill
 * and the caption preview that are plainly visible inside the button are all
 * invisible to getByRole("button", { name: ... }). The first take failed here
 * with `control not found: /^Publish now$/`, because "Publish now" does not
 * exist in the DOM at all until this row is open.
 */
const expandPost = () =>
  new RegExp(
    `^Expand post ${requireEnv(
      "DEMO_POST_ID",
      "It is the social_posts row id for this video's TikTok post — NOT the video id.",
    )}$`,
  )

export const CHAPTERS = [
  {
    id: "01-connection",
    title: "The linked TikTok account",
    url: "/admin/platform-connections",
    beats: [
      {
        text: "This is the Connections page on darrenjpaul.com. It is where a coach links the accounts they post to.",
      },
      {
        text: 'TikTok is linked here. We show the account name, "darrenjpaul_", so the coach can see exactly which account their videos will go to.',
      },
      {
        text: "That name is the only thing we read from the TikTok profile. We do not read followers, or videos, or anything else.",
      },
      {
        text: "The coach can unlink the account here whenever they want, and we stop posting to it.",
      },
    ],
  },
  {
    id: "02-library",
    title: "The coach's own videos",
    url: "/admin/content?tab=videos",
    beats: [
      {
        text: "These are training videos the coach filmed and uploaded themselves. Nothing here comes from anyone else.",
      },
      { text: "The coach opens the one they want to post.", scroll: 0.25 },
    ],
  },
  {
    id: "03-caption",
    title: "Reviewing the caption",
    get url() {
      return videoUrl()
    },
    beats: [
      { text: "This is the video itself, with the caption that will go out with it." },
      { text: "Each account the coach has linked gets its own caption. This is the one for TikTok.", scroll: 0.45 },
      {
        // Opens the row. Until this happens the page shows only a two-line
        // PREVIEW of the caption, so the next line would be narrating an
        // editable box that is not on screen.
        text: "The coach can change any word of it before it goes anywhere. Nothing is posted automatically.",
        get click() {
          return expandPost()
        },
      },
    ],
  },
  {
    id: "04-publish",
    title: "Posting it to TikTok",
    get url() {
      return videoUrl()
    },
    // Chapter 4 records in its own context, so it has to scroll down AND open
    // the row itself rather than inheriting chapter 3's end state. "Publish
    // now" is not in the DOM until the row is open.
    setup: [
      { scroll: 0.45 },
      {
        get click() {
          return expandPost()
        },
      },
    ],
    beats: [
      { text: 'When the coach is happy with it, they press "Publish now".' },
      {
        text: "We now send the video file itself to TikTok, a piece at a time, and then create the post with that caption.",
        click: /^Publish now$/,
      },
      {
        text: "That is the whole flow. The coach picks their own video, checks the caption, and presses one button.",
      },
    ],
  },
]
