# Review follow-ups — initial-ui-setup

Source: `reviews/impl-review.md`

- [ ] **F9 — Reflected `?error=` text on sign-in.** `src/pages/auth/signin.astro:5` shows the raw query string in the `ServerError` alert. It is escaped, so there is no XSS, but it allows content spoofing. Have `src/pages/api/auth/signin.ts` redirect with an error *code* and map codes to fixed messages on the page. This fits S-04 or S-09.
- [ ] **F7 — Config banner prominence.** The destructive `Alert` is red text on `bg-card`. Consider a destructive-tint background token in `/10x-ui`.
