# Dev walkthrough: the app as a delivered user sees it

**Local development only** (`npm run dev` against local Supabase). The account is created by a delivery, as in production, and the delivery also sends it an invitation. The real path is to open that invitation in Mailpit (`http://127.0.0.1:54324`) and set a password on the page it links to; step 2 is a shortcut for local testing (local Supabase sends at most 2 auth emails per hour). In production, accounts get their password only through the invitation; there are no manual accounts or test deliveries there.

The rules behind each step are in [Pages and API](api.md).

1. Deliver the sample for your email and an upcoming week. `start` must be a Monday after today (Europe/Warsaw); the day dates are shifted to match. The response shows `"account_created":true`.

   ```bash
   jq --arg email you@example.com --arg start 2026-10-12 '
     ((($start + "T00:00:00Z") | fromdate) - ((.week_start + "T00:00:00Z") | fromdate)) as $shift
     | def move: ((. + "T00:00:00Z") | fromdate) + $shift | strftime("%Y-%m-%d");
     .user.email = $email | .week_start = $start | .week_end |= move | .days |= map(.date |= move)' \
     scripts/fixtures/mo-delivery.sample.json > /tmp/mo-delivery.json

   curl -i http://localhost:4321/api/mo/deliveries \
     -H "Authorization: Bearer $MO_INGEST_TOKEN" \
     -H "Content-Type: application/json" \
     --data @/tmp/mo-delivery.json
   ```

2. Either open the invitation in Mailpit and set a password, or give the account a password through the local Admin API, using the local `SERVICE_ROLE_KEY` (from `npx supabase status -o env`) as both `apikey` and bearer token. Find the user's `<id>` in Studio (**Authentication → Users**) or with the `GET` below.

   ```bash
   curl -s http://127.0.0.1:54321/auth/v1/admin/users \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
     | jq -r '.users[] | select(.email == "you@example.com") | .id'

   curl -X PUT http://127.0.0.1:54321/auth/v1/admin/users/<id> \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"password": "<a password>", "email_confirm": true}'
   ```

3. Sign in at `/auth/signin` with that email and password, and check that `/dashboard` shows the delivered week. A user without a delivered upcoming week sees "No upcoming plan yet" instead (in the "Next week" tab once a current week exists).

4. Deliver a second week to see the tabs: run step 1 again with `--arg start` set to this week's Monday (Europe/Warsaw; today counts if it is a Monday), and send `/tmp/mo-delivery.json` with the same `curl`. The response shows `"account_created":false`. Reload `/dashboard`: it now has two tabs. "This week" shows the plan for the current week and "Next week" (open by default) the upcoming one. Neither shows recency notes yet: a week that has started can't be saved, and the upcoming one isn't saved.

5. Swap a meal: in "Next week", tap another option of any slot. The status line reads "Saved <time> · Editable until <Sunday before the week>". Reload `/dashboard`: the option is still selected. On a never-saved plan, "Keep these picks" saves it without swapping. The "This week" plan from step 4 has no controls: it has started, so the API answers 409 for it. Saving makes the plan count for recency notes at once: choosing a meal that is also chosen on an earlier day of the same saved week gives the later one a note straight away, and on a plan that isn't saved yet the same meal gets none.

6. Deliver a later week to see that "Next week" stays on the nearest one: run step 1 again with `--arg start` set to the Monday after the upcoming week you saved, and send `/tmp/mo-delivery.json` with the same `curl`. Reload `/dashboard`: "Next week" still shows the saved week, as it is the nearest upcoming one; the later week isn't shown until the saved one starts. Then it becomes "Next week", and every meal you chose in the saved week carries a note such as "In your plan 7 days earlier (Mon 12 Oct)". The recommended option you swapped away has no note, and neither does anything from the "This week" plan, which was never saved. Had you not saved the earlier week, the later one would show no notes at all.

7. Deliver a past week to see the history: run step 1 again with `--arg start` set to the Monday 7 days before this week's Monday, and send `/tmp/mo-delivery.json` with the same `curl` (a first delivery of a started week is stored). Open `/history` (the "History" link on the dashboard): it lists that week as "Not saved". Open it: it shows the week's meals and "Not saved: suggested picks". The dashboard's tabs don't change, and the week gives no recency notes, as it was never saved.

8. Rate a meal: in "This week" (from step 4), tap a face under a meal of today or an earlier day, for example 😋. Reload `/dashboard`: the face is still pressed, and in "Next week" every option with the same meal shows "Last rated 😋 Chef's kiss" (although "This week" was never saved) and, as 😋 is 5/5, is listed first in its slot, with the star. The plan was saved in step 5, so its selection doesn't change; on a plan that isn't saved, the option would also be selected. Tap the pressed face again to clear the rating; after a reload the note is gone. Meals of later days and options that aren't chosen have no faces.
