# Moving generation to Cloud Tasks — deploy runbook

**Nothing in this change takes effect until the Firebase deploy lands.** Until
then the app is unchanged in behaviour, because the enqueue path only runs for
job docs it also creates.

## Why

A Firestore `onDocumentCreated` trigger is capped at **540s** and the deploy
rejects anything higher — this is a platform limit, not a setting. The
generation budget was 450s so that it would blow *before* the platform kill and
leave ~90s for the catch path to write `status="failed"` and email the coach. A
hard kill skips that and wedges the job in `"processing"` forever, unrecoverable
because the handler skips non-`pending` docs.

Task-queue functions get **1800s**. That is the only way a run longer than nine
minutes can finish at all.

| Trigger | Ceiling | Budget now |
|---|---|---|
| `onDocumentCreated` (Eventarc) | 540s, hard | 450s |
| `onTaskDispatched` (Cloud Tasks) | 1800s | **1500s** |

`programChat` is deliberately NOT migrated. It is interactive — a coach waits on
it — so a 25-minute budget would be the wrong shape. It stays on the 540s path.

## Three settings that are load-bearing

Change any one and the others quietly stop mattering.

1. **`retryConfig: { maxAttempts: 1 }`** on both task functions. Cloud Tasks
   retries any non-2xx by default. A generation that throws at minute 24 would
   re-run from the top: another full-price Anthropic run, and a second week
   written over the first. The handler guards on `status === "pending"`, which
   does not save you — a retry after a *failed* run sees `"failed"` and stops,
   but a retry after a *partial write* does not unwrite it.
2. **`dispatchDeadlineSeconds: 1800`** on every enqueue. Cloud Tasks cancels the
   request at its own deadline and marks it `DEADLINE_EXCEEDED` regardless of
   the function's `timeoutSeconds` — and **that deadline defaults to 600s**.
   Leave it unset and the 1500s budget dies at ten minutes, looking exactly like
   the model hanging. 1800s is the documented maximum.
3. **`dispatch: "task"` on the job doc.** The Eventarc triggers are still
   deployed and still fire on create. They check this field and yield. Remove it
   and every queued job runs **twice** — two AI runs, two charges, two weeks
   written over each other.

## Deploy order

The app and the functions deploy separately, so both paths have to work during
the window between them. They do: a job doc without `dispatch` takes the old
Eventarc path at 450s, one with it takes the queue at 1500s.

**Deploy the functions FIRST.** The queue is created by deploying the function,
and the app cannot enqueue onto a queue that does not exist yet. Deploying the
app first means every generation answers `503 "Could not queue the generation.
The AI functions may not be deployed yet."` — which is at least the honest
failure, not a silent one.

```bash
# 1. Functions first — this creates the weekGenerationTask and
#    programGenerationTask queues.
cd functions && npm run deploy      # or: firebase deploy --only functions

# 2. Confirm the queues exist before touching the app.
gcloud tasks queues list --location=us-central1
#    expect: weekGenerationTask, programGenerationTask

# 3. Then the app (Vercel).
```

## The IAM grants — there are TWO, and the second is easy to miss

Enqueuing needs BOTH of these on the service account the Next app runs as (the
`client_email` in `FIREBASE_SERVICE_ACCOUNT_KEY`). Granting only the first looks
complete and still fails, which is exactly what happened on 2026-09-21:

```
The principal (user or service account) lacks IAM permission
"iam.serviceAccounts.actAs" for the resource
"firebase-adminsdk-fbsvc@<project>.iam.gserviceaccount.com"
```

**1. Create tasks:**

```bash
SA=<client_email from FIREBASE_SERVICE_ACCOUNT_KEY>
gcloud projects add-iam-policy-binding <project-id> \
  --member="serviceAccount:$SA" \
  --role="roles/cloudtasks.enqueuer"
```

**2. Act as itself.** Cloud Tasks calls the function with an OIDC token minted
for a service account, so whoever enqueues must be allowed to ACT AS that
account — here, itself. This is a binding ON the service account, not on the
project, which is why it is a different command shape and easy to skip:

```bash
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" \
  --role="roles/iam.serviceAccountUser" \
  --project=<project-id>
```

**3. Invoke the function.** Cloud Tasks delivers the task by calling the Cloud
Run service behind the function, and the OIDC identity must be allowed to invoke
it. A fresh task-queue function deploys with an EMPTY IAM policy
(`etag: ACAB`, no bindings), so this is never there by default:

```bash
for FN in weekgenerationtask programgenerationtask; do
  gcloud run services add-iam-policy-binding "$FN" \
    --member="serviceAccount:$SA" \
    --role="roles/run.invoker" \
    --region=us-central1 --project=<project-id>
done
```

Note the service names are LOWERCASE — Cloud Run lowercases the function name.

Each grant only reveals the next, because each is enforced at a different
boundary: Cloud Tasks API (enqueuer) → IAM at token-mint time (actAs) → Cloud
Run at delivery (invoker). Granting one and stopping looks like progress and
still fails.

## DEPLOY ALL FUNCTIONS, NOT JUST THE NEW ONES

`firebase deploy --only functions:weekGenerationTask` deploys exactly that one
and leaves every other function on OLD code — including `weekGeneration`, whose
whole job in this migration is to CHECK `dispatch:"task"` AND STAND DOWN. An old
`weekGeneration` has no such check, so it picks up every queued job and runs it
with stale code. That happened on 2026-09-21: the task function 403'd (missing
invoker, above) while the old Eventarc trigger quietly ran the same jobs on the
pre-migration model. Once invoker is granted, BOTH fire on the same job — two AI
runs, two charges, two weeks written over each other.

```bash
cd functions && firebase deploy --only functions --project <project-id>
```

The tells that a function is running old code, from its logs:

  * a model id that is not the current default
  * `[callAgent] Using structured tool_use output` — the current line reads
    `[callAgent] Structured output via <branch>`
  * no OpenRouter attempt and no fallback line at all

Either one missing gives a 503 with the job marked failed. That is the designed
failure — visible, recoverable, and it does NOT leave the job stranded as
"pending" (which would block the coach from retrying by hand). Verified in
production on 2026-09-21: the Eventarc trigger correctly ignored the
`dispatch:"task"` doc, so nothing double-ran.

If you would rather not also grant `cloudfunctions.functions.get` (the Admin SDK
uses it to resolve the function's URL), set this env var on Vercel and the SDK
skips the lookup:

```
FIREBASE_GENERATION_TASK_URI_BASE=https://us-central1-<project-id>.cloudfunctions.net
```

It is optional. Unset, the lookup happens and needs the extra read permission.

## How to tell it worked

Generate a week and watch the function logs.

- `weekGenerationTask` should log, and `weekGeneration` should log NOTHING AT
  ALL — its guard returns before any work. `firebase functions:log` may not
  surface application stdout; read Cloud Logging directly instead:

  ```bash
  gcloud logging read 'resource.labels.service_name="weekgeneration"' \
    --limit=5 --format="value(textPayload)" --project=<project-id> --freshness=10m
  ```
- If **both** log for one job, the `dispatch` guard is not working — stop and fix
  it before running anything else, because every generation is now billing twice.
- A long run should now be able to pass 540s. It could not before.

```bash
firebase functions:log --only weekGenerationTask
gcloud tasks queues describe weekGenerationTask --location=us-central1
```

## Rolling back

Revert the app deploy. Job docs stop carrying `dispatch: "task"`, the Eventarc
triggers pick them up again at 450s, and the task functions simply go idle. No
data migration either way — the job doc has been the source of truth throughout,
and the task only ever carried its id.

## Still unresolved

The run that prompted this failed at exactly 450.0s on Fable 5.1. The control
that would have shown whether the model or the larger prior-week context was
responsible died on `"credit balance is too low"`, so **nobody has measured what
a long generation actually needs.** 1500s is headroom, not a fitted number. Once
the Anthropic account has credit, re-run the control before assuming the ceiling
was the problem:

```bash
npx tsx scripts/probe-week-generation.ts control --week 4 --override NONE
```
