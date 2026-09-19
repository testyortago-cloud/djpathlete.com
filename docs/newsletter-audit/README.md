# Newsletter list audit — 2026-09-12

Read-only scan of `newsletter_subscribers` on **production**. Nothing was changed.

**5,894 rows. 5,891 active. 101 flagged + 3 unresolvable, plus 6 duplicate pairs.**

> **Correction 2 — 2026-09-12, same day.** Running the finished checker against the live list
> three times gave three different answers (DEAD 49 / 50 / 49). Cause: the resolver code
> treated *every* DNS failure as "domain does not exist", so a transient timeout became a
> `dead` verdict — i.e. "delete this subscriber". Fixed by requiring an authoritative
> `ENOTFOUND`/`ENODATA` for `dead` and adding a fallback resolver. **Result: 3 addresses move
> from "confirmed dead" to "unresolvable — do not delete", and two live US military domains
> stop being deletion candidates.** See §3g. Confirmed dead is now **46**, not 49. The run is
> now byte-identical across three consecutive executions.
>
> **Correction 1 — 2026-09-12.** The first pass used `dig +short MX | grep -c .`,
> which counts an RFC 7505 *null MX* (`0 .` — "this domain refuses mail") as a valid
> record. Re-checking all 726 domains for a null MX found **one** missed address,
> `olson@pacificcoastgroup.com`. Undeliverable goes 48 → 49; flagged 103 → 104. Nothing
> else moved. `scripts/check-email-deliverability.mjs` handles null MX correctly and is
> what found this.

The headline is not the duplicates. It is that **98.6% of this list arrived in one CSV
import, it has never been mailed, and it contains a machine-generated spam-trap cluster.**

---

## 1. The formatting is genuinely clean — the problem is elsewhere

Every basic-hygiene check came back zero. This is not a sampling artefact; these ran over
all 5,894 rows:

| Check | Count |
|---|---|
| Malformed (fails `local@domain.tld`) | **0** |
| Missing / multiple `@` | **0** |
| Leading, trailing or embedded whitespace | **0** |
| Stored with uppercase | **0** |
| Double dots, leading/trailing dots | **0** |
| Non-ASCII characters | **0** |
| Empty strings | **0** |
| Exact duplicates (case-insensitive) | **0** |

That is not luck. `email` carries a `UNIQUE` constraint, and both write paths
(`addSubscriber` and `addSubscriberWithAttribution` in [lib/db/newsletter.ts](../../lib/db/newsletter.ts))
`.toLowerCase().trim()` before an upsert on `onConflict: "email"`. **The ingestion path is
sound and needs no fix.** Every problem below entered through the CSV import, which
bypassed it.

The `contacts` table (170 rows) is clean too — no duplicates, no malformed addresses, no
stray case or whitespace, and no row lacking both an email and a phone.

---

## 2. Where the list came from — the real finding

| Source | Rows | Window |
|---|---|---|
| `csv_import` | **5,814** (98.6%) | almost all 2026-06-16 17:37 |
| `ghl_sync` | 78 | 2026-03-03 → 03-17 |
| `website` | **2** | 2026-05-01, 2026-05-25 |

Two people have ever used the signup form on the site. Everything else was imported.

Three facts compound this:

- **`contact_suppressions` is empty. `contact_consents` is empty. `marketing_consent_log` is empty.**
  There is no record of consent for any of these 5,891 people, and no suppression list.
- **Exactly one newsletter has ever been sent** (`newsletters.status='sent'`). So there is
  no bounce history to learn from — the first real send is also the first deliverability test.
- The domain mix is wrong for an athlete-coaching newsletter: an Italian *agriturismo*, a UK
  Islamic fatwa council, a dental practice reception desk, German engineering firms, a
  reptile breeder. That is the signature of a **purchased or scraped B2B list**, not an
  audience that asked to hear from Darren.

---

## 3. Broken and undeliverable — 60 addresses

Classified by resolving MX and A records for all 726 distinct domains, not by guessing at
spellings. All 60 are still marked active, as are the 3 unresolvable in §3g.

### 3a. Dead domains — 46 addresses, guaranteed hard bounce

Authoritative NXDOMAIN/NODATA: no MX *and* no A record, or an RFC 7505 null MX. 32 domains.
(Three further domains are unreachable rather than provably dead — see §3g.) The largest:

| Domain | Addresses | Note |
|---|---|---|
| `immenseignite.info` | **8** | local parts are 8 random letters — `osnsrtuu`, `vqrxhxjh`, … |
| `spectrail.world` | 3 | |
| `gmail.con` | 2 | typo of `gmail.com` |
| `anaphora.team`, `carnana.art`, `maxeza.click`, `silesia.life` | 2 each | |
| 25 more | 1 each | incl. `gmal.com`, `xyz.com`, `pacificcoastgroup.com` (null MX), lapsed business domains |

**~30 of these are one machine-generated batch.** The pattern is unmistakable once you line
them up: `6 random letters` + `.` + `6–8 random letters` `@` `invented-word` `.` `cheap TLD`
— `aaplyw.tjqjbmw@maxeza.click`, `ejrfjj.tpdmmbw@carnana.art`, `hhrrde.bjhqbqq@zetetic.sbs`.
The local parts draw from a restricted alphabet (b, c, d, h, j, m, p, q, t, w) and contain
almost no vowels. These are **spam traps or list-inflation filler**, and they are the single
most dangerous thing in the table.

### 3b. Typosquats with LIVE mail servers — 2 addresses, worse than a bounce

| Address domain | Resolves to |
|---|---|
| `gamil.com` | `mail.gamil.com` |
| `iclould.com` | `mail.emailofsteel.com` |

These do **not** bounce. Someone else's mail server accepts the message. Sending here leaks
content to a typosquat operator and is a classic route onto a blocklist. They are easy to
miss precisely because a bounce report will never flag them.

### 3c. No MX record — 9 addresses

Domain has a website but publishes no mail server: `client.com`, `hotmal.com` (typo of
`hotmail.com`), `lvcss.org`, `mbksearch.com`, `myputter.ch`, `sportclub.com`,
`teamomega.com`, `treehss.com`, `university.edu`. Nearly always undeliverable — RFC 5321
permits an A-record fallback, so a few might land.

### 3d. Disposable mailboxes — 3 addresses

`muell.io` ("Müll" = rubbish), `sudomail.com`, `superrito.com`.

### 3e. Placeholders — 3 addresses

`john@example.com`, `jane.smith@example.com`, `test@dev.com`. Two more placeholder-shaped
addresses (`test9@client.com`, `athlete@university.edu`) are counted in 3c since their
domains fail DNS as well.

### 3f. The typo addresses are mostly duplicate PEOPLE — 4 of 6 are safe to delete outright

Six addresses sit on a misspelt provider domain. For each, I checked whether the same local
part exists at the **correctly spelled** domain:

| Typo address | Corrected | Already subscribed? |
|---|---|---|
| `nikitatang1128@gamil.com` | `…@gmail.com` | **yes** |
| `ojuzair@gmal.com` | `…@gmail.com` | **yes** |
| `phamlamnhunghi200.7@iclould.com` | `…@icloud.com` | **yes** |
| `yortago@gmail.con` | `…@gmail.com` | **yes** |
| `kaciawager@gmail.con` | `…@gmail.com` | no |
| `matisescalebeaute@hotmal.com` | `…@hotmail.com` | no |

**Four of the six are the same person twice** — once with a typo, once correctly — so deleting
the typo row costs nothing; that subscriber is already reachable. This is a second,
independent duplicate class on top of the six Gmail alias pairs in §4.

The remaining two have no correct twin. Both are undeliverable as written. You can either drop
them or add the corrected spelling, but **do not add a corrected address as a new subscriber
without evidence they asked to be on the list** — an inferred correction is a guess about a
real person, and it is also a fresh unconsented signup.

### 3g. Three "dead" domains are actually unprovable — and two live ones were nearly deleted

The checker's DNS handling had the same flaw twice over, and finding it changed two numbers.

**Three domains are not provably dead**, only unreachable: `madisonsofallon.net`,
`exp-sys.com`, `edberg-online.com` (1 address each). Every public resolver returns SERVFAIL and
they have **no NS records at all** — the delegation is broken or expired. They are almost
certainly gone, but that is an inference, not the authoritative NXDOMAIN the other 46 give.
They are now reported as `unresolvable` and excluded from the bounce count. Do not delete them
on this evidence; re-check first.

**More seriously, two live domains were at risk.** `army.mil` and `us.af.mil` SERVFAIL on both
Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`) — US military DNS filters the big public
resolvers — while Quad9 resolves them perfectly to real mail servers
(`pri-nipr.eemsg.mail.mil`, `ter-nipr.eemsg.mail.mil`). Under the original code those two real
subscribers would intermittently have been reported `dead`, and this report's own advice is
"remove the dead ones". The checker now consults a second resolver before giving up, and they
come back `ok` on every run.

The general shape is worth keeping: **a verdict that causes deletion must rest on positive
evidence of absence, never on the absence of evidence.** "The nameserver did not answer" and
"the domain does not exist" are different facts, and only one of them justifies a delete.

---

## 4. Duplicates — 6 pairs, and they break unsubscribe

No exact duplicates exist (the `UNIQUE` constraint prevents them). But six pairs are
**different strings addressing the same Gmail inbox**, because Gmail ignores dots:

| Inbox | The two rows |
|---|---|
| `jamaicaisland@gmail.com` | `jamaica.island@` / `jamaicaisland@` |
| `jayaraujo59@gmail.com` | `jayaraujo59@` / `jayarauj.o59@` |
| `jsciscokid28@gmail.com` | `jsciscokid.28@` / `jsciscokid28@` |
| `kathievitanza@gmail.com` | `kathievitanza@` / `k.athievitanza@` |
| `mrlioneljones@gmail.com` | `mr.lionel.jones@` / `mr.lioneljones@` |
| `plazaa74@gmail.com` | `plazaa.74@` / `plazaa74@` |

All twelve rows came from the same CSV import and all twelve are active.

**This is a compliance problem, not just a double-send.** `removeSubscriber` matches with
`.eq("email", …)` on the exact string ([lib/db/newsletter.ts:44](../../lib/db/newsletter.ts#L44)),
and the unsubscribe route passes through whatever the user submitted
([app/api/newsletter/unsubscribe/route.ts:21](../../app/api/newsletter/unsubscribe/route.ts#L21)).
So when one of these six clicks unsubscribe, **one row is silenced and the other keeps
sending to the same inbox.** From their side, they opted out and you ignored it — which is
exactly the complaint that turns into a spam report.

Nobody has hit this yet only because nobody has unsubscribed yet.

---

## 5. Role addresses — 38

Shared company inboxes: 23 × `info@`, 4 × `admin@`, 3 each `office@` / `contact@`, plus
`sales@`, `billing@`, `orders@`, `reception@`, `general@`, `mail@`.

Not broken, and deliverable. But they reach a front desk rather than a person, they convert
near zero, and they attract complaints at a much higher rate than personal addresses.
Judgment call — I have flagged them rather than grouped them with the undeliverables.

---

## 6. What I'd do, in order

Nothing below has been executed. The first item is the only urgent one.

1. **Do not send to this list as it stands.** 46 guaranteed bounces plus ~30 probable spam
   traps in a first send from a domain with no sending reputation is how a domain gets
   blocked. On a 5,891 send the bounce rate is only ~0.8%, under the 2% danger line — but
   bounce rate is not the risk here. **Spam traps are.** One trap hit can blocklist the
   sending domain outright, and that domain is `send.darrenjpaul.com`, which the lead-engine
   sequences also use. A newsletter send could take the automated sequences down with it.

2. **Remove the 46 dead + 2 typosquat + 3 disposable = 51 rows** (NOT the 3 unresolvable). These have no possible
   upside. Run `scan.sql` to regenerate the exact list with ids, then delete by id.

3. **Merge the 6 Gmail alias pairs, and drop the 4 typo rows whose correct twin is already
   subscribed (§3f).** For the alias pairs keep the earlier row. Better still,
   fix the mechanism: canonicalise Gmail addresses on unsubscribe so opting out silences
   every row reaching that inbox. The mechanism fix is worth more than the six rows.

4. **Decide on the 9 no-MX and 38 role addresses.** My call: drop the 9, keep the 38 but
   segment them out of anything measured for engagement.

5. **Establish consent provenance before any bulk send.** With `contact_consents` and
   `marketing_consent_log` both empty, there is no evidence any of the 5,814 imported
   addresses agreed to this. That is a GDPR/CAN-SPAM exposure independent of deliverability,
   and it is worth answering *where the CSV came from* before mailing it.

6. **If sending goes ahead, warm up.** Start with the ~80 `ghl_sync` + `website` rows, then
   engaged recipients only, and grow volume over weeks. Never 5,891 cold in one send.

**The ingestion code needs no change.** The only code-level fix worth making is the
unsubscribe canonicalisation in item 3.

---

## Reproducing the DNS classification

The domain lists in `scan.sql` are a snapshot. A dead domain can be re-registered and a live
one can lapse, so re-resolve before acting on a later date:

```sh
# Pull distinct domains, then for each: MX, falling back to A.
# A domain with neither is a guaranteed bounce.
dig +short MX "$domain" || dig +short A "$domain"
```

A caution worth carrying forward: my first pass at typo detection used a hand-written regex
and flagged `yahoo.com.hk` and `yahoo.com.tw`, which are **real** regional Yahoo domains.
Switching to edit distance then flagged `ea.com`, `levi.com`, `tql.com`, `twc.com` and
`wmg.com` — all real companies (EA, Levi's, Total Quality Logistics, Time Warner, Warner
Music) whose short names sit within 2 edits of `me.com` or `aol.com`. **Neither spelling
heuristic is trustworthy on its own. DNS resolution is the only check that actually
answers "can this receive mail".** Every number in this report is DNS-backed for that reason.

Similarly, a "random-looking local part" is not evidence by itself: `cdklontz@gmail.com`,
`johndmcg@gmail.com` and `wmjdarby@gmail.com` all match the bot pattern and are plainly real
people's initials. What identifies the spam cluster is the **combination** of a random local
part with a throwaway domain.

---

## The free checker — `scripts/check-email-deliverability.mjs`

No API key, no account, no cost. Reads addresses from the database, a file, or stdin (a CSV
column works — it takes the first field containing an `@`) and classifies each one.

**Pick one — these are alternatives, not steps to run in sequence.**

```sh
# Check the live newsletter list. No export step, no file of addresses left on disk.
node scripts/check-email-deliverability.mjs --from-db .env.prod

# Check a file you already have (one address per line, or a CSV with an email column).
node scripts/check-email-deliverability.mjs my-list.csv

# Check whatever is on the clipboard.
pbpaste | node scripts/check-email-deliverability.mjs -
```

Add `--csv` for machine-readable output. Run it with no arguments to see this usage.

### The generated CSVs

Two files sit in this folder after a run. **Both are gitignored** (`.gitignore` →
`docs/newsletter-audit/*.csv`) because they contain real subscriber addresses; only this README
and `scan.sql` are tracked. Regenerate them any time:

```sh
node scripts/check-email-deliverability.mjs --from-db .env.prod --csv > docs/newsletter-audit/results.csv
head -1 docs/newsletter-audit/results.csv > docs/newsletter-audit/flagged.csv
awk -F'","' 'NR>1{v=$3; gsub(/"/,"",v); if(v!="ok") print}' docs/newsletter-audit/results.csv >> docs/newsletter-audit/flagged.csv
```

| File | Rows | What it is |
|---|---|---|
| `flagged.csv` | 101 | **Start here.** Everything that is not `ok`, worst first. |
| `results.csv` | 5,891 | Every address including the 5,790 `ok`. |

Columns: `email, domain, verdict, reason`. Open in Numbers/Excel, or filter on the command line:

```sh
# just the guaranteed bounces
awk -F'","' '$3 ~ /dead/' docs/newsletter-audit/flagged.csv

# count by verdict
awk -F'","' 'NR>1{gsub(/"/,"",$3); c[$3]++} END{for(k in c) print c[k], k}' docs/newsletter-audit/results.csv | sort -rn
```

Exits `1` if anything is `dead` or `invalid`, so it can gate a send in CI.

| Verdict | Meaning |
|---|---|
| `dead` | Authoritative NXDOMAIN/NODATA, or a null MX. **Hard-bounces, always.** |
| `invalid` | Malformed. Bounces. |
| `typosquat` | Misspelt provider with live MX. Does *not* bounce — a stranger gets it. |
| `risky` | A record but no MX. Usually bounces. |
| `disposable` | Throwaway mailbox service. |
| `placeholder` | `example.com` and friends. |
| `unknown` | DNS would not answer. **Never delete on this** — re-run first. |
| `role` | `info@`, `admin@` — a shared inbox, not a person. |
| `ok` | The domain accepts mail. |

### What it cannot do, and why

**`ok` does not mean "won't bounce".** It means the *domain* accepts mail.
`john.smith@gmail.com` and `asdfgh@gmail.com` are indistinguishable to this tool — same MX,
same verdict. Proving a *mailbox* exists needs an SMTP `RCPT TO` handshake on port 25, which
is not implemented because it doesn't work:

- **Port 25 is blocked outbound** on most ISPs and cloud hosts, this machine included.
  (Verified: `gmail-smtp-in.l.google.com:25` times out while `smtp.gmail.com:587` connects —
  so it's port 25 specifically, not the network.)
- **It wouldn't be reliable even unblocked.** Gmail, Yahoo and Outlook accept every `RCPT TO`
  and only reject after the message body, so every address returns "valid". Catch-all domains
  accept everything by design. Greylisting defers a first attempt from an unknown IP.
- **It risks your own reputation.** Mailbox probing is what spammers do to harvest, and
  providers blocklist IPs that do it.

Paid verifiers (ZeroBounce, NeverBounce, Kickbox) get past some of this with warmed IPs and
provider-specific tricks, at roughly $0.004/address — about **$24 for this list**. They still
cannot answer Gmail reliably; they guess from reputation data.

**The only thing that proves an address won't bounce is sending to it.** So: strip the `dead`
and `invalid` with this tool, send a small batch, and read the bounces from Resend — which is
free, already wired up, and is ground truth rather than inference.

### A trap this tool already avoids

It resolves against `1.1.1.1` / `8.8.8.8` rather than the system resolver. Some ISP resolvers
hijack `NXDOMAIN` and return an ad server's A record for *every* miss — which would turn every
dead domain into a live-looking one and silently invert the whole result.

It then falls back to Quad9 / OpenDNS when the first pair will not answer, and distinguishes an
authoritative "does not exist" from "did not answer". Both matter: `army.mil` SERVFAILs on
Cloudflare and Google but resolves fine on Quad9, so a single-resolver run reports live military
mailboxes as dead (§3g).

It also treats an RFC 7505 **null MX** as dead. That is what the correction at the top of this
file was about: `dig +short MX | grep -c .` sees the `0 .` line and calls it a valid MX.
