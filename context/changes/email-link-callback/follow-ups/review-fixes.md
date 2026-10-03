# Review follow-ups

Queued from `reviews/impl-review-phase-1.md`.

- **F1 (Phase 3 handoff):** add to the "Handoff to S-04/S-05" line in F-01's roadmap block and to the comments on #8 and #5: `/api/auth/confirm` uses up the single-use token on the GET the link opens, so mail scanners that prefetch links (Microsoft Defender Safe Links, corporate gateways) can consume it before the user clicks. Each slice's set-password page should take `token_hash` + `type` on GET and call `verifyOtp` only on the form POST.
- **F2 (Phase 3):** run `npx prettier --write context/foundation/roadmap.md` in the same commit as the F-01 handoff line. The F-01 row's `in-progress` status widens the At-a-glance table, so the whole table gets re-padded. Do it in one commit and expect a whitespace-only conflict with S-03's roadmap edits.
