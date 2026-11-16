# Post to TikTok: entry point

Captured from the real running app (production build, development database clone) with `node scripts/capture-tiktok-post-dialog.mjs`. The script writes nothing to the database and asserts that no non-GET request reached `/api/admin/social/posts/*`.

- `01-posts-tab-tiktok-row.png` - Content Studio video page, Posts section. The bulk bar says "TikTok posts are sent one at a time from their own row." and the expanded TikTok row has its own "Schedule" and "Publish now" buttons.
- `02-dialog-connect-first.png` - After clicking the TikTok row's "Publish now": the "Post to TikTok" dialog, which finds no connected TikTok account and shows "Connect TikTok on the Connections page first." with only a Close button.
- `raw/` - the same two shots without annotations.

Light theme only: the admin UI has no dark mode.

The full form (account name, video preview, privacy, interaction boxes, disclosure, declaration) needs a connected TikTok account. It will be captured once the TikTok sandbox account is connected.
