# Lead Engine — where it stands, 24 August 2026 (evening)

Written for a read-through, not for a developer. The technical version of the
same picture is `docs/lead-engine-status-2026-08-24.md`.

---

## The short version

The whole follow-up system is built and installed on the live site: the emails,
the texts, the chat assistant, the pipeline board, and now the quiz.

**Almost none of it is switched on.** That is a choice, not a fault — nothing
sends until somebody says so.

---

## The one thing that needs a decision

**73 real people are waiting to be asked permission to text them. They have been
waiting since 22 August. Nothing has gone out.**

These are people brought over from GoHighLevel. They are queued and ready. The
switch that lets messages send is off, so the system has never even tried — no
errors, no failures, just nothing.

**Turning that switch on sends all 73 at once, two days late.** So the decision
is: let them go as they are, or re-date them first and send fresh.

Nobody should flip that switch by accident. It is the only step here that
reaches real people.

---

## What works today

| | Does it work? | Is it switched on? |
|---|---|---|
| Storing people, merging duplicates, keeping their history | Yes | Yes — 166 people brought over from GoHighLevel |
| Recording who agreed to be emailed or texted, and who opted out | Yes | Yes |
| Follow-up messages that go out on a schedule | Yes | **No** — this is the master switch |
| The nine follow-up sequences themselves | Yes — 18 emails and 8 texts written | Four are paused, four are drafts, one is live |
| The pipeline board | Yes | Yes, but empty — nothing has come through it yet |
| Linking money earned back to the advert that brought it | Yes | Yes |
| Sending texts | Built | **No** — waiting on Twilio's approval |
| The chat assistant on the website | Yes | **No** — switched off |
| The quiz: questions, branching, scoring, results, alerts | Yes | Yes, but there is no quiz on the live site yet |
| Making a quiz yourself, and editing its questions | Yes — new this evening | Yes |

---

## What is not finished

| | Why it matters | Who it is waiting on |
|---|---|---|
| **There is no quiz on the live site** | The quiz works, but it is empty. Nobody has made one yet | You — it takes a few clicks |
| **The quiz's marking is guesswork** | The old scores were lost when GoHighLevel exported. The numbers in there now are sensible guesses, and the screen says so | You |
| **The four result follow-ups have no words in them** | The quiz can sort somebody into a group, but has nothing to send them afterwards | You |
| **Changeover from GoHighLevel has not started** | GoHighLevel still runs the real quiz and brings in most of the leads | Running both side by side first |
| **Two GoHighLevel jobs still have no home here** | One sets up a client's account when a sale is won. One sends injury details to Airtable | Not built yet |
| **Texts cannot send** | Twilio has not finished checking the account | Twilio — one to three weeks |
| **A security gap on the deal records** | Who is in the pipeline and what they are worth can be read by anyone who knows where to look. It needs a small fix | Nobody has picked it up |

---

## What only you can decide

1. **The 73 people.** Send as they are, or re-date them first.
2. **The quiz marking.** Every score and every band needs your eye before a real
   athlete is told what it means.
3. **The words in the four result follow-ups**, then whether they go live.
4. **Where each result sends people.** Right now: "Talk to us" for the two most
   urgent results, the online programme for the middle one, and an assessment
   for the least urgent.
5. **Whether the new quiz runs alongside the GoHighLevel one for a while**, or
   replaces it outright. Alongside is safer.

---

## What changed this evening

- The quiz went in — questions, branching, marking, results, and the alert that
  tells you when somebody scores badly.
- You can now make a quiz yourself from the funnels screen, and add, reword or
  remove questions afterwards. Before this evening a quiz could only be put
  together by hand, by a developer.
- Removing a question somebody has already answered no longer deletes it. It is
  set aside instead, so your reports still know what was asked.
- The chat assistant's answers are now laid out properly — bold text and lists
  read as bold text and lists, instead of showing the raw symbols.

---

## One caveat about this report

Everything about the live site's **contents** — the 73 people, the 166 brought
over, which switches are off — was read from the live system this morning, not
this evening. Nothing done since would have changed those numbers. Everything
about what has been **built** was checked this evening.
