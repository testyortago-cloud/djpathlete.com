# DJP AI Automation — Account Security & Prerequisites (Client Guide)

**Who this is for:** Darren (the account owner). You own every social account that the automation system will connect to. This guide is your checklist for getting each account ready — **business structure, security hardening, and what to hand over to the developer.**

You are not writing code. You are making sure the accounts are secure, correctly set up, and ready to connect.

---

## Golden Rules (apply to every account below)

1. **Turn on two-factor authentication (2FA)** on every account listed here. Use an authenticator app (Google Authenticator, Authy, 1Password). **Do not rely on SMS** — it can be SIM-swapped.
2. **Use a password manager** (1Password, Bitwarden, Dashlane). Every password should be unique and 20+ characters.
3. **Use your business email** `darren@darrenjpaul.com` for all platform sign-ups. Never use personal Gmail. If you leave a service, the email goes with the business — not you.
4. **Never share passwords.** Share *access* through each platform's role-based permissions (Facebook Business Manager roles, YouTube managers, LinkedIn admins). You can revoke access instantly without changing the password.
5. **Back up your 2FA recovery codes.** Every platform gives you 8–10 one-time codes when you enable 2FA. Print them and store offline (safe, locked drawer). If your phone is lost and you don't have these, you're locked out for weeks.
6. **Add a backup admin** on every platform that supports it. If your account is ever locked or compromised, the backup admin can recover access. This is the single most important thing you can do.
7. **Review connected apps monthly.** Every platform has a "Connected Apps" or "Business Integrations" screen. If you see something you don't recognize, remove it.
8. **Only you should be the primary admin.** Add the developer as a limited-role admin — never the primary.

---

## 1. Facebook + Instagram

### What you need before we can connect

1. A **Facebook Business Manager** account (business.facebook.com) registered to DJP Athlete.
2. The DJP Athlete **Facebook Page** claimed inside Business Manager.
3. Your Instagram account converted to a **Business** or **Creator** account.
4. Instagram linked to the Facebook Page (Page Settings → Linked Accounts → Instagram).

### Security to enable

- **2FA on Facebook** (Settings → Security → Two-Factor Authentication → Authentication App).
- **2FA on Instagram** (Settings → Security → Two-Factor Authentication).
- **Business Manager Security Center** → turn on "Require 2FA for everyone" for your business.
- Add a **backup admin** (trusted family member or co-owner) to Business Manager so you are never locked out.
- Review **Business Integrations** (Settings → Business Integrations) every month and remove anything old.

### What you hand over

- Admin access to the Facebook Page and Business Manager (the developer will be added as a limited admin).
- Nothing else. We will generate the technical tokens ourselves once we have admin access.

---

## 2. TikTok

### What you need before we can connect

1. A TikTok account logged in under your business email.
2. The account switched to a **TikTok Business Account** (Settings → Manage Account → Switch to Business Account).
3. If TikTok Ads Manager will be involved later, a **TikTok Business Center** account at business.tiktok.com.

### Security to enable

- **2FA on TikTok** (Settings → Security and permissions → 2-step verification → authenticator app).
- **Login alerts** turned on.
- A recovery email that is **not** the same as your login email — this prevents a single point of failure.
- Review **Manage logged-in devices** monthly and kick off anything you don't recognize.

### What you hand over

- Business-admin-level access to the TikTok account.
- Your verified business email so TikTok's app-review team can contact you if they need proof of business.

### Heads up

TikTok's review process is stricter than Meta. They will audit the app and may ask to see proof that DJP Athlete is a real business. **Keep your business registration documents handy** (business license, EIN, or equivalent) — we may need to upload them.

---

## 3. YouTube

### What you need before we can connect

1. A **Google account** under your business email (`darren@darrenjpaul.com`). Not your personal Gmail.
2. The DJP Athlete **YouTube channel** owned by that Google account, and converted to a **Brand Account** (this lets you add managers without sharing your login).
3. Channel **phone-verified**. Unverified channels can't upload videos longer than 15 minutes.

### Security to enable

- **2FA on the Google account** (myaccount.google.com → Security → 2-Step Verification → authenticator app or hardware key).
- Enable **Advanced Protection Program** if you want the highest security tier (requires 2 hardware security keys — recommended for brand safety).
- In YouTube Studio → **Settings → Permissions**: confirm only trusted people have Manager or Editor roles.
- Review **Third-party apps with account access** (myaccount.google.com/permissions) monthly.

### What you hand over

- **Manager** role on the YouTube Brand Account for the developer (YouTube Studio → Settings → Permissions → Invite). Not Owner.
- Nothing else.

### Heads up

Google requires formal **OAuth verification** before the app can upload videos on your behalf. This takes **4–6 weeks** and requires a **privacy policy page** live at djpathlete.com/privacy before we can submit. Get the privacy policy published early — it is the most common blocker.

---

## 4. LinkedIn

### What you need before we can connect

1. A **personal LinkedIn profile** under your business email.
2. The **DJP Athlete Company Page** created and administered by that profile.
3. Your personal profile listed as a **Super Admin** of the Company Page.

### Security to enable

- **2FA on LinkedIn** (Settings → Sign in & security → Two-step verification → authenticator app).
- **Where you're signed in** — review monthly, sign out stale sessions.
- Add a **second Super Admin** (trusted co-founder or family member) to the Company Page so LinkedIn can't lock you out.

### What you hand over

- **Content Admin** or **Curator** role on the Company Page for the developer. Not Super Admin.
- Your verified company email so LinkedIn's partnership review team can reach you if needed.

### Heads up

LinkedIn requires a partnership review for company-page posting APIs. **Allow 2–4 weeks.** They may interview you to verify the business use case. Be ready to describe: what DJP Athlete does, who the audience is, and why automated posting is legitimate.
