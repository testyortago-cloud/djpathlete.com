# Coach reachability — annotated shots

Captured by `scripts/capture-coach-reachability.mjs` against the real app on
`localhost:3050`, on the dev clone. Every annotation is burned into the `.png`,
so each file explains itself with nothing else open.

Nothing here is a harness, a fixture or a mock. Each run:

1. signs in as the operator and creates a business through the real
   `/admin/businesses/new` form,
2. seeds that business's contacts, pipeline cards and chat conversations —
   because an empty screen is a broken demo, not a demonstration,
3. invites a coach through that business's own **Invite a coach** dialog on the
   default **Coach** preset,
4. claims the invite at `/invite/<token>`, which creates a **genuinely new user
   account** — then reads it back and fails loudly if the account does not hold
   `contacts`, so the shots cannot silently drift from the preset,
5. drives the coach's own session through the three screens.

| # | Shot | What it proves |
|---|---|---|
| 01 | `01-invite-coach-preset.png` | The **Coach** preset — the default on the invite dialog — now includes Contacts & Pipeline. Before this change it granted five areas and none of them reached a contact list. |
| 02 | `02-coach-sidebar.png` | Contacts, Pipeline and Chat assistant in a real coach's sidebar. All three were absent before, and typing the address by hand bounced them to `/admin/no-access`. |
| 03 | `03-coach-contacts-scoped.png` | Their business's contacts and nobody else's. The caption states the live count of contacts in *other* businesses on the same database — read back at capture time, not asserted. |
| 04 | `04-coach-contact-record.png` | One person's whole history. Note there is **no "Add to a sequence" button**: that posts to a route a coach cannot use, so it is hidden rather than left to 403. |
| 05 | `05-coach-pipeline.png` | The coach's own board, with their own cards. |
| 06 | `06-coach-chat.png` | Website chat conversations, scoped the same way. |
| 07 | `07-control-without-the-permission.png` | **The control.** Same account, same address, permission switched off — refused. Without this shot, every one above is equally consistent with a gate that admits everybody. |

## Two shots that were wrong first, and are worth knowing about

**Shot 05 originally captured a 500.** `/admin/pipeline` rendered *"This admin
page hit an error"* for the coach: `create_business()` never seeded a pipeline,
so `resolvePipeline` threw `PipelineNotConfiguredError` for every business it
had ever created. Every page-tenancy test was green throughout, because they all
mock `readBoard` — a test that mocks the read cannot see the read failing. Fixed
in migration `00249`, and the capture script now fails loudly if the admin error
boundary appears instead of shooting it.

**Shot 02's third marker pointed at the wrong row.** "Chat assistant" lives in
the Marketing group, which is collapsed by default, so the marker resolved to a
real but hidden element and landed on the "Business" header below it. The script
now expands the group first — selecting the toggle by `aria-controls`, because
the label is uppercased by CSS and Playwright matches the DOM's own casing.

## Re-running

Needs the dev server up and migration `00249` applied to whatever database
`.env.local` points at:

```
npm run dev                                    # port 3050
node scripts/capture-coach-reachability.mjs
```

Each run creates one business, one invite and one user account on the dev clone,
and leaves them there. It writes nothing to production.
