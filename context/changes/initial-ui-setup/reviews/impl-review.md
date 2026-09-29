<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Initial UI Setup

- **Plan**: context/changes/initial-ui-setup/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria re-verified on the branch: lint PASS, `astro check` PASS (0/0/0), build PASS, smoke PASS (9/9), palette grep empty. All 5 manual items ticked with user confirmation. F1 shows that 2.8 missed an unstyled link.

## Findings

### F1 — Confirm-email "Back to sign in" link renders unstyled

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/auth/confirm-email.astro:34-36
- **Detail**:
  - The plan specified `<Button asChild variant="link"><a …></Button>`. In an `.astro` file, Astro passes the children to React as a static-HTML wrapper, not as the `<a>` element.
  - Radix `Slot` therefore merges the button classes into that wrapper, and they are lost. The dev server renders a bare `<a href="/auth/signin">` with no classes, and Tailwind's base reset makes it look like plain body text.
  - The plan's assumption that `asChild` works in static rendering was wrong.
- **Fix**: Replace it with `<a href="/auth/signin" class={buttonVariants({ variant: "link" })}>`, importing `buttonVariants` from `@/components/ui/button`. Add a line to CLAUDE.md: "never use `asChild` from `.astro`; use `buttonVariants()` on the element".
- **Decision**: FIXED (buttonVariants on <a>; CLAUDE.md asChild rule added)

### F2 — Sign-in, confirm-email and dashboard lost their `<h1>`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/signin.astro, src/pages/auth/confirm-email.astro, src/pages/dashboard.astro (CardTitle)
- **Detail**:
  - shadcn `CardTitle` renders a `<div>`. The old pages used `<h1>`, so they now have no page heading.
  - This hurts screen readers and document outline. It comes from the plan ("CardTitle heading"), not from drift.
- **Fix**: Wrap the title text in `<h1>` inside `CardTitle` on the three pages.
- **Decision**: FIXED (<h1> inside CardTitle on 3 pages)

### F3 — Legacy signup page: token-styled components on a hard-coded dark background

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/signup.astro:9-21, via FormField.tsx:60, SignUpForm.tsx:59, ServerError.tsx
- **Detail**:
  - `signup.astro` still paints the dark `bg-cosmic` background regardless of OS mode, but the shared components now use theme tokens.
  - In OS light mode: error text is about 3.8:1 contrast, and hint and placeholder text about 3.9:1, both below AA 4.5:1. The server-error Alert shows as a white `bg-card` box inside the dark glass card.
  - Labels and typed text are fine.
- **Fix A ⭐ Recommended**: Accept for now; S-04 removes sign-up.
  - Strength: Respects the plan's "not doing signup.astro" boundary; zero extra work.
  - Tradeoff: The page looks off in OS light mode until S-04 lands.
  - Confidence: MED — depends on S-04 landing soon.
  - Blind spot: S-04 timing is not verified.
- **Fix B**: Move signup.astro to the same `bg-background` + Card shell as signin (about 10 lines).
  - Strength: Removes the mismatch and one legacy exception from the CLAUDE.md rule.
  - Tradeoff: Scope creep into a page S-04 will delete.
  - Confidence: HIGH — the signin.astro pattern can be copied directly.
  - Blind spot: None significant.
- **Decision**: ACCEPTED (Fix A — signup.astro left as legacy until S-04 removes it)

### F4 — Two Radix package styles in use

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/label.tsx:3 vs src/components/ui/button.tsx:2; package.json
- **Detail**:
  - `label.tsx` imports from the unified `radix-ui` package, while `button.tsx` imports from the per-package `@radix-ui/react-slot`.
  - The unified package adds about 80 lockfile entries. They are tree-shaken from the bundle but make installs heavier.
- **Fix A ⭐ Recommended**: Switch `button.tsx` to `import { Slot } from "radix-ui"` (the current shadcn default) and uninstall `@radix-ui/react-slot`.
  - Strength: Matches what `npx shadcn add` generates now, so future components stay consistent.
  - Tradeoff: Keeps the heavier unified install.
  - Confidence: HIGH — this is the current new-york output.
  - Blind spot: The `Slot` export shape in radix-ui 1.6 is unverified (likely `Slot.Root`).
- **Fix B**: Install `@radix-ui/react-label`, rewrite the `label.tsx` import, and uninstall `radix-ui`.
  - Strength: Lean lockfile; matches the existing button.
  - Tradeoff: Every future `shadcn add` will re-introduce `radix-ui`.
  - Confidence: MED — the fix will be undone the next time a component is added.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — button.tsx uses radix-ui Slot.Root; @radix-ui/react-slot uninstalled)

### F5 — Dark-mode inline script declares global `const`s

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/layouts/Layout.astro:19-24
- **Detail**: The top-level `const mq` and `const apply` sit in the page's global scope. A future script with the same names, or a re-run under `<ClientRouter />`, would throw a redeclaration SyntaxError.
- **Fix**: Wrap the script body in `{ … }` or an IIFE.
- **Decision**: FIXED (script body wrapped in a block)

### F6 — Stale `variant="error"` prop on Banner

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/Layout.astro:30
- **Detail**: Banner.astro no longer declares props, so the call site passes a dead prop.
- **Fix**: Drop `variant="error"` from the `<Banner>` call.
- **Decision**: FIXED (dead prop removed)

### F7 — Config banner is less prominent than before

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/Banner.astro:7
- **Detail**: The destructive Alert variant is red text on `bg-card`, not the old tinted band. It is consistent with the tokens but easier to miss.
- **Fix**: Leave as is; revisit in `/10x-ui` (for example with a destructive-tint token).
- **Decision**: ACCEPTED (left as is; revisit in /10x-ui)

### F8 — FormField: hint not announced; text runs under password toggle

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/FormField.tsx:53-60
- **Detail**:
  - The `hint` is not linked via `aria-describedby`.
  - With `endContent` present, the input has no `pr-10`, so long values run under the eye icon.
  - Both predate this branch.
- **Fix**: Add `${id}-hint` to `aria-describedby` and `pr-10` when `endContent` is set.
- **Decision**: FIXED (hint linked via aria-describedby; pr-10 with endContent)

### F9 — `?error=` query text is reflected into the sign-in alert

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/signin.astro:5, src/components/auth/ServerError.tsx:12
- **Detail**: The text is escaped (no XSS), but an attacker can put arbitrary wording in a `role="alert"` box (content spoofing). This predates the branch.
- **Fix**: Follow-up: map error codes to fixed messages (fits S-09 or S-04).
- **Decision**: DEFERRED (queued in follow-ups/review-fixes.md for S-04/S-09)

## Triage summary (2026-09-29)

- **Fixed**: F1, F2, F4 (Fix A), F5, F6, F8
- **Accepted**: F3 (Fix A, until S-04), F7
- **Deferred**: F9 (see `follow-ups/review-fixes.md`)
- **Gates after fixes**: lint PASS (formatting auto-fixed, attempt 1/2), `astro check` PASS, build PASS, colour grep empty. smoke PASS (9/9) on the restarted dev server; user confirmed the confirm-email link renders green and underlined.
