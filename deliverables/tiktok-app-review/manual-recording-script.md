# TikTok app review — recording the demo by hand

TikTok rejected the 2026-09-21 submission. Their reviewer said the demo video must be recorded by a
person clicking through the real site — not by an automated tool — and must show every product and
scope working, end to end, using the sandbox. This page is the script for that recording.

**Do not reuse `tiktok-demo.mp4`.** It was recorded by an automated browser and edited with captions
and title cards, which is exactly what the reviewer refused.

## Before you record

Do these in order. Steps 1 and 3 change production, so only do them when you are ready to record.

1. **The Post to TikTok screen must be live.** The branch `worktree-tiktok-post-dialog` has to be
   merged and deployed first. Without it, the reviewer sees a post screen that breaks TikTok's rules.
2. **Create the sandbox** in the TikTok Developer Portal (your app → Sandbox):
   - Add **Login Kit** and **Content Posting API** (with Direct Post turned on).
   - Tick only the scopes **user.info.basic** and **video.publish**. Leave **video.upload** off.
   - In Login Kit, add the redirect URI
     `https://www.darrenjpaul.com/api/admin/platform-connections/tiktok/callback`.
   - Under **Target users**, add a TikTok account you own. Set that TikTok account to **private** in
     the TikTok app first: TikTok only lets an app that is not yet approved post to private accounts.
3. **Point the site at the sandbox.** If the sandbox shows its own Client key and Client secret, put
   them into Vercel → Production → `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`, then redeploy.
   This disconnects `darrenjpaul_` until you swap back (it cannot post today anyway). If the sandbox
   shows the same key as production, skip this step.
4. **Pick the video** you will post: a short clip (under a minute) that already has its TikTok post
   in Content Studio.

## How to record

- Use the Mac's own screen recorder (**Cmd + Shift + 5** → "Record Selected Portion") around the
  whole browser window. **The address bar must be visible the whole time**, showing
  `www.darrenjpaul.com`.
- Click through it yourself at a normal pace. Pause for a second on each thing the reviewer needs to
  read.
- No captions, arrows, zooms, music, speed-ups or title cards. Trimming the start and the end is fine.
- To show the post on TikTok, use **tiktok.com in the same browser**. Do not film a phone with a camera.
- Each file must be under 50 MB. You may upload up to 5 videos, so two clips is fine (see step 8).
  If a file is too big, open it in QuickTime and use File → Export As → 1080p.

## The walk-through

1. **Connections page.** Open `https://www.darrenjpaul.com/admin/platform-connections`. Show that TikTok
   is not connected yet.
2. **Log in with TikTok (Login Kit).** Click Connect on the TikTok card. TikTok's own page opens and
   lists what the app asks for. Pause on that list. Log in with the sandbox account and approve.
3. **Back on Connections.** The TikTok card now shows the account's name. Pause on it. This is what
   **user.info.basic** is used for.
4. **Content Studio.** Open Content Studio, open your video, go to its posts, and open the **TikTok**
   row. Show the caption.
5. **Click "Publish now".** The **Post to TikTok** screen opens. Go through it slowly, top to bottom:
   - Point at the **account name and @username** at the top: this is the account it will post to.
   - Play the **video preview** for two or three seconds.
   - Change a word in the **caption**, to show it can be edited.
   - Open **"Who can view this video"**. Show that nothing is picked yet, then choose **Only me**.
   - Show that **Comment, Duet and Stitch** all start unticked. Tick **Comment**.
   - Turn on **"Disclose video content"**. Show **Your brand** and **Branded content** and the label
     line under them. Then turn it **off** again.
   - Pause on the line **"By posting, you agree to TikTok's Music Usage Confirmation."**
   - Click **Post to TikTok**.
6. **Confirmation.** The message "Sent to TikTok. It can take a few minutes to appear on your profile."
   appears, and the row now says Scheduled.
7. **Wait for it to go out.** The site sends it within 5 minutes. Refresh the page until the TikTok
   row says **Published**.
8. **Show it on TikTok.** Open `https://www.tiktok.com`, logged in as the sandbox account, go to the
   profile and open the new video. It is marked private ("Only me"). This proves **video.publish**
   end to end.
   - If you would rather not record the 5-minute wait, stop the recording after step 6. Then start a
     second recording at step 7. Upload both clips.
9. **Optional:** back on Connections, click Disconnect on TikTok, to show a coach can unlink at any time.

## Filling in the form

- **Products and scopes:** Login Kit (user.info.basic) and Content Posting API (video.publish).
  **Untick video.upload.** It was the "Scopes mismatch" in the rejection; the site no longer asks for it.
- **Products and scopes explanation:** paste `app-review-explanation.txt` (956 of 1000 characters).
- **Demo video:** the clip or clips you just recorded.

## After you submit

Swap `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` back to the production values in Vercel, redeploy,
and reconnect `darrenjpaul_` on the Connections page.
