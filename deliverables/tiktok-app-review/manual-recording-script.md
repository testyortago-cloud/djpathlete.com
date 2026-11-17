# TikTok app review — recording the demo by hand

TikTok rejected the 2026-09-21 submission. Their reviewer said the demo video must be recorded by a
person clicking through the real site — not by an automated tool — and must show every product and
scope working, end to end, using the sandbox. This page is the script for that recording.

**Do not reuse `tiktok-demo.mp4`.** It was recorded by an automated browser and edited with captions
and title cards, which is exactly what the reviewer refused.

## Before you record

Do these in order. Steps 1 and 3 change production, so only do them when you are ready to record.

1. **The Post to TikTok screen and "Send to TikTok drafts" must be live.** Both are merged and
   deployed (the drafts button since branch `worktree-tiktok-drafts`).
2. **Create the sandbox** in the TikTok Developer Portal (your app → Sandbox):
   - Add **Login Kit** and **Content Posting API** (with Direct Post turned on).
   - The scopes should be exactly **user.info.basic**, **video.publish** and **video.upload**. The last
     one comes with the Content Posting API and cannot be removed, which is why the demo shows drafts.
     Remove anything else.
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
- Each file must be under 50 MB. You may upload up to 5 videos, so several clips are fine (see steps 8
  and 10).
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
9. **Send one to drafts (video.upload).** Back in Content Studio, open a different video's **TikTok**
   row and click **Publish now**. On the Post to TikTok screen, read out the line under the buttons
   ("Drafts open in the TikTok app…") and click **Send to TikTok drafts**. The message "Sent to your
   TikTok drafts. Open TikTok and check your inbox to finish and post it." appears.
10. **Show the draft arriving.** On your phone, start the phone's own screen recording (iPhone: Control
    Centre → Screen Recording), open the TikTok app as the sandbox account, open the inbox
    notification for the upload, and show the video ready to edit and post. Stop. Upload this phone
    recording as its own clip. A phone's own screen recording is fine; filming the phone with a camera
    is not.
11. **Optional:** back on Connections, click Disconnect on TikTok, to show a coach can unlink at any time.

## Filling in the form

- **Products and scopes:** Login Kit (user.info.basic) and Content Posting API (video.publish,
  video.upload). On 2026-11-17 the three scopes nothing used (user.info.profile, user.info.stats,
  video.list) were removed. They were the "Scopes mismatch" in the rejection.
- **Products and scopes explanation:** paste `app-review-explanation.txt` (946 of 1000 characters).
- **Demo video:** remove the old `tiktok-demo.mp4` first, then upload the clips you just recorded.

## After you submit

Swap `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` back to the production values in Vercel, redeploy,
and reconnect `darrenjpaul_` on the Connections page.
