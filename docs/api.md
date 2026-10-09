# Pages and API

What each page shows and what each route does. Dates and cut-offs are always in Europe/Warsaw.

## Pages

| Page                    | Access    | Shows                                                                                                                                         |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                     | anyone    | Redirects to `/dashboard` when signed in, otherwise to `/auth/signin`                                                                         |
| `/auth/signin`          | anyone    | Sign-in form under the logo, with a "Forgot or never set a password?" link; signed in, redirects to `/dashboard`; fixed error messages only   |
| `/auth/forgot-password` | anyone    | Asks for an email and sends a link to set a new password; answers the same whether or not the account exists; fixed error messages only       |
| `/auth/set-password`    | anyone    | Where invitation and password-reset emails link (`?token_hash=…&type=invite` or `recovery`): a password form (8+ characters); saving signs in |
| `/dashboard`            | protected | "Next week" (the upcoming plan, editable) and "This week" (the current plan, read-only, with ratings) tabs                                    |
| `/history`              | protected | Past weeks, newest first                                                                                                                      |
| `/history/<id>`         | protected | One past week, read-only, with ratings                                                                                                        |

Protected pages redirect anonymous visitors to `/auth/signin`; the list is `PROTECTED_ROUTES` in `src/middleware.ts`. The JSON routes below that use a cookie session are deliberately not in it: they answer 401 themselves instead of redirecting.

## Accounts and email links

There is no public sign-up: an invitation is the only way to get an account. The first MO delivery for an unknown email creates the account (unconfirmed, `app_metadata.provisioned_by = "mo-delivery"`) and sends it an invitation (Supabase Admin API `inviteUserByEmail`). Later deliveries send no second invitation. If the invitation email can't be sent (for example the email rate limit), the delivery still stores the week and returns 200, the failure is only logged, and the user can get a password through "Forgot or never set a password?" on the sign-in page.

| Route                            | Effect                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/signin`          | Form post; signs in and redirects to `/dashboard`, or back to `/auth/signin?error=<code>`                                   |
| `POST /api/auth/signout`         | Signs out and redirects to `/`                                                                                              |
| `POST /api/auth/forgot-password` | Form post; sends a reset email and redirects to `/auth/forgot-password?sent=1` (for unknown emails too), or `?error=<code>` |
| `POST /api/auth/set-password`    | Form post from `/auth/set-password`; verifies the emailed token, saves the password and signs in on `/dashboard`            |
| `GET /api/auth/confirm`          | Forwards old-style invitation and reset links, unverified, to `/auth/set-password`; it verifies nothing itself              |

**Single-use tokens are used only on the form post.** Opening a link never uses its token, so mail scanners that prefetch links can't burn it, and nobody can be signed in by a link they merely opened. A too-short password is refused before the token is used, with the link still usable.

**Dead links show at once.** Opening a used, replaced (a newer link of the same kind was sent), made-up or expired link, or one without a token, shows "This link is invalid or has expired" and "Ask for a new link" instead of the form. A link that dies while the form is open ends, on posting, on `/auth/forgot-password` with the same message.

**Retry after a refused password.** If Supabase refuses the password after the token was used (for example the current password again), the user keeps the session and, for 10 minutes, can retry on `/auth/set-password` without a token (the `mo-password-retry` cookie). A signed-in session alone can't change the password.

**How the page checks a link.** The `auth_link_is_valid` Postgres function, called with the service-role key, mirrors Supabase Auth's own rule (GoTrue v2.197.0): the token must have a row in `auth.one_time_tokens` and must have been sent less than an hour ago (`AUTH_LINK_LIFETIME_SECONDS` in `src/lib/set-password.ts`, equal to `otp_expiry` in `supabase/config.toml`). It reads the Supabase-managed tables `auth.one_time_tokens` and `auth.users`. It fails open: if it can't run (service-role key missing, database error, 2 s timeout), the page shows the form, logs `auth link check …`, and the post decides. See the [known risks](deployment.md#known-risks) for what a Supabase upgrade can break.

The email templates live in `supabase/templates/` and are wired up in `supabase/config.toml`. Local Supabase reads them only at start, so restart it (`npx supabase stop && npx supabase start`) after changing them. Local emails are not sent; they land in Mailpit at `http://127.0.0.1:54324`. Production templates are pasted by hand, see [deployment](deployment.md#email-settings-and-templates).

## MO delivery

`POST /api/mo/deliveries` is how Meal Orchestrator (MO) delivers a user's weekly plan: the week's full menu with every option's score. It is machine-to-machine: no cookie session, the middleware skips it, and it must never be added to `PROTECTED_ROUTES`.

- **Auth:** `Authorization: Bearer <MO_INGEST_TOKEN>`. A missing or wrong token returns 401.
- **Body:** payload v1, defined by `moDeliverySchema` in `src/lib/mo-delivery.ts`. A sample is in `scripts/fixtures/mo-delivery.sample.json`.
- **Storage:** one call to the `ingest_weekly_plan` Postgres function through a service-role client. An unknown email first becomes an account, with an invitation (see above).
- **Re-sending a week:** an identical body (same JSON content, `run_id` included) changes nothing. A changed body for an upcoming week replaces its options (see [re-delivery](#re-delivery)). A changed body for a week that has started (its Monday is today or earlier) is refused with 409 `week_started`, so "This week" never changes. A first delivery of a week that has started is stored.
- **Responses:** 200 `{"plan_id","week_start","account_created"}`; 400 `invalid_payload` with the validation issues; 401 `unauthorized`; 409 `week_started`; 413 `payload_too_large` over 256 KiB; 500 `storage_failed` (details in the Worker logs); 503 `not_configured` when `SUPABASE_SERVICE_ROLE_KEY` or `MO_INGEST_TOKEN` is missing.

The full contract for the MO side, with what MO should retry, is [`mo-delivery-contract.md`](mo-delivery-contract.md). To try it against `npm run dev` (rewrite the email to a local user's, or a new one to see provisioning):

```bash
curl -i http://localhost:4321/api/mo/deliveries \
  -H "Authorization: Bearer $MO_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @scripts/fixtures/mo-delivery.sample.json
```

The sample's week is in the past; the [dev walkthrough](dev-walkthrough.md) moves it to an upcoming week.

## Weeks on the dashboard and in history

- **"Next week"** is the nearest week whose Monday is after today. A later delivered week is stored but shown only once the nearer one has started. Without one, the tab shows "No upcoming plan yet".
- **"This week"** is the week whose Monday is today or up to 6 days earlier. It is read-only.
- **History:** a week is past once its `week_start` is today minus 7 days or earlier. `/history` lists past weeks with "Saved" or "Not saved" ("No past plans yet" when there are none). `/history/<id>` shows "Saved <time>" or "Not saved: suggested picks", and answers 404 "Plan not found" for an id that isn't a UUID, an unknown plan, someone else's plan, and the current or an upcoming week.
- If the plans can't be loaded (a database error), the dashboard and both history pages answer 200 with "Couldn't load your plan" or "Couldn't load your history". Right after sign-in, PostgREST can reject the new session once with `PGRST303 JWT issued at future`; the plan services retry that error and log `… PGRST303 JWT issued at future, retry n/2 …`.

## Swapping and saving the upcoming plan

"Next week" lists every option of every meal slot, best first:

- **Order:** MO's score adjusted by the user's rating of the meal (the one "Last rated" shows, see [ratings](#ratings)). A meal rated 5/5 comes first and one rated 1/5 last, MO's score ordering each group. In between, 4/5 adds 2 to MO's score, 2/5 takes 2 off, and 3/5 or no rating keeps it. Ties go to the higher MO score, then to the menu's order.
- **Star:** the first option, and any option tied with it on both scores.
- **Selection:** the user's choice. Until they swap, it is the suggested pick: the first option.
- **Status line:** "Not saved yet" or "Saved <time>", plus "Editable until <Sunday before the week>".

Tapping another option saves it immediately; a plan nobody swapped can be saved as it is with "Keep these picks".

| Route                     | Body                   | Effect                                                 |
| ------------------------- | ---------------------- | ------------------------------------------------------ |
| `POST /api/plans/choose`  | `{ planId, optionId }` | Makes the option the chosen one of its slot, and saves |
| `POST /api/plans/confirm` | `{ planId }`           | Saves the plan as it is, without changing any choice   |

- **Responses:** 200 `{"saved_at","recency"}`, where `recency` maps option ids to the date the meal was last chosen earlier (`null` if that re-read failed; the save still stands); 400 `invalid_request` with the validation issues; 401 `unauthorized`; 404 `not_found` (no such option or plan, or someone else's); 409 `plan_locked`; 413 `payload_too_large` over 4 KiB; 500 `save_failed`; 503 `not_configured`.
- **Cut-off:** a plan can be changed while its `week_start` is after today, so until Sunday 23:59 before the week starts. From Monday 00:00 any save is answered 409. The `choose_plan_option` and `confirm_plan` Postgres functions enforce this and the ownership check, so a stale page can't bypass it.

### Re-delivery

When MO re-sends an upcoming week with changes:

- The week's options are replaced.
- A plan that was never saved follows the new delivery's suggested picks and stays "Not saved yet".
- A saved plan keeps each chosen dish that the new delivery still offers in the same meal, and stays saved. Where the dish is gone, the suggested pick is chosen.
- On a page opened before the re-send, a swap no longer works (the option ids are new): the tap shows "This plan was updated. Reload to see the latest version." "Keep these picks" is not caught: it still saves, with the new delivery's choices.

### Recency notes

An option whose meal was chosen earlier shows a note such as "In your plan 7 days earlier (Mon 12 Oct)". Notes count only the meals chosen in saved plans: a plan counts once it is saved (swapped, or kept with "Keep these picks"), and from that moment on, including its own earlier days. Plans never saved, plans delivered too late to edit, and the upcoming plan's own earlier days until it is saved give no notes. Meals are matched by (`provider`, `provider_meal_id`), never by name.

## Ratings

Under each chosen meal of the last 7 days (today minus 7 days to today, both included), "This week" and `/history/<id>` show "How was it?" and five faces: 🤢 Never again, 😕 Meh, 😐 Fine, 🙂 Tasty, 😋 Chef's kiss. Tapping a face saves it at once; tapping another changes it, and tapping the pressed face again clears it.

- Only the chosen meal of a slot can be rated (the suggested pick when the plan was never saved; a week first delivered after it started keeps the pick made at delivery), and no meal before its day.
- Outside that window a stored rating is shown read-only (for example "😋 Chef's kiss"), and other meals show no faces.
- On "Next week", an option whose meal was rated on an earlier day shows "Last rated 😋 Chef's kiss". It is the rating of the latest earlier day the meal was rated on, not the latest tap, and it doesn't depend on the earlier plan being saved. The same rating orders the slot and decides its suggested pick.
- **Late ratings:** rating a meal or clearing its rating re-picks every upcoming week of the user that isn't saved and offers that meal, so its suggested picks follow the new rating. Saved plans and weeks that have started are never re-picked. An open "Next week" tab shows the new picks only after a reload; until then "Keep these picks", or a swap of another slot, saves the re-picked choices, not the ones shown.

| Route               | Body                                       | Effect                                                   |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `POST /api/ratings` | `{ optionId, rating }` (`1`-`5` or `null`) | Rates the meal, or clears its rating with `rating: null` |

- **Responses:** 200 `{"rating"}` (the stored rating, or `null` after a clear); 400 `invalid_request` with the validation issues (for example a rating of 6); 401 `unauthorized`; 404 `not_found` (no such option, or someone else's); 409 `not_rateable` (not the chosen option of its slot, or its day is outside the window); 413 `payload_too_large` over 4 KiB; 500 `save_failed`; 503 `not_configured`.
- The `rate_meal` Postgres function enforces the ownership check, the chosen option and the window; `get_plan_ratings` gives the "Next week" ratings. If the ratings can't be loaded, the dashboard shows the plan without them and logs `dashboard ratings load failed: …`.
