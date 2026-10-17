# Review fixes

## From reviews/impl-review-phase-1.md

- [x] **F1** — In Phase 2's `tests/e2e/rated-days.spec.ts`, assert that a collapsed day's `<h3>` inside `<summary>` is exposed as a heading in Chromium, e.g. `getByRole("heading", { name: /^Monday\b/ })` within the collapsed card. If it isn't, apply the plan's fallback: keep the visible text and give the `<summary>` an accessible name that starts with the weekday, then make the spec locate the day by that name.
