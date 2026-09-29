# Initial UI Setup Implementation Plan

## Overview

Wire the in-scope views (sign-in, confirm-email, dashboard, layout banner and the shared auth components) to the design tokens that already exist in `src/styles/global.css`. Enable light and dark mode following the OS preference, set a green accent, and remove starter leftovers. The goal: a future theme change (via `/10x-ui`) visibly changes the app, which it does not today.

## Current State Analysis

From `context/changes/initial-ui-setup/research.md`:

- `src/styles/global.css` has complete `:root`, `.dark` and `@theme inline` blocks with the stock shadcn neutral palette (`global.css:6-111`), plus a hard-coded `bg-cosmic` gradient utility (`global.css:113-115`).
- Views outside `src/components/ui/` use zero token utilities. All colour comes from hard-coded `white/*`, `blue-*`, `purple-*`, `red-*` classes on `bg-cosmic`.
- The only `Button` consumer, `SubmitButton.tsx:18`, overrides the variant colours through `className`, so even the button ignores the theme.
- Nothing sets the `dark` class, so `.dark` never applies (`@custom-variant dark (&:is(.dark *))`, `global.css:4`).
- `src/components/ui/` holds only `button.tsx` and the unused `LibBadge.astro`.
- `components.json` has `aliases.hooks: "@/hooks"`, which conflicts with CLAUDE.md (`src/components/hooks/`).
- No CSP is configured (`astro.config.mjs`), so an inline script in `<head>` is allowed.
- `scripts/smoke.mjs` asserts only HTTP status codes and redirect locations (`smoke.mjs:73-82`), so markup changes don't affect it.
- No UI test tooling is installed (no Playwright or Vitest). CI runs lint, `astro check`, build and smoke (`.github/workflows/ci.yml`).

## Desired End State

- `/auth/signin`, `/auth/confirm-email` and `/dashboard` render with token utilities only (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-destructive`, …) through shadcn `Card`, `Button`, `Input`, `Label` and `Alert`.
- With the OS in light mode the pages are light neutral with green primary actions. With the OS in dark mode they are dark neutral with a brighter green. Switching the OS setting while a page is open switches the page without reload. There is no white flash on load in dark mode.
- The sign-in page no longer links to sign-up.
- CLAUDE.md tells the next agent to style through tokens and component variants, not colour classes.
- Verify: lint, `astro check`, build and smoke pass; the user eyeballs the 3 pages in both modes.

### Key Discoveries:

- `cn()` uses tailwind-merge (`src/lib/utils.ts`), so colour classes passed via `className` silently override component variants (`SubmitButton.tsx:18`). This is why the new CLAUDE.md rule is needed.
- `global.css:117-124` already applies `border-border outline-ring/50` to every element and `bg-background text-foreground` to `body`. Once page wrappers stop painting `bg-cosmic`, the body tokens show through.
- React components without hooks or event handlers (shadcn `Card`, `Alert`, `Button`) render as static HTML in `.astro` files without a `client:*` directive. Forms still submit natively. That makes them usable from `dashboard.astro`, `confirm-email.astro` and `Banner.astro`.
- `Layout.astro:22-35` renders `Banner variant="error"`. The `info` and `warning` variants in `Banner.astro:27-36` are unused.

## What We're NOT Doing

- Restyling `Welcome.astro`, `Topbar.astro` or `signup.astro` (S-09 replaces `/`; S-04 removes sign-up). `bg-cosmic` stays in `global.css` because `Welcome.astro` still uses it. `signup.astro` changes only indirectly, through the shared auth components.
- A manual light/dark toggle (OS preference only for now).
- Gradient or brand tokens; the cosmic gradients are dropped, not tokenised.
- Final visual design. The green accent is a starting point for `/10x-ui`.
- Playwright, screenshot tests or a lint rule against hard-coded colours (S-09 introduces browser tests).
- Changing the Layout's default title or any copy other than removing the sign-up link.
- Adding `badge` (no in-scope view needs one).

## Implementation Approach

Phase 1 lays invisible groundwork: token values, the dark-mode switch, config and new primitives. Nothing on screen changes except focus-ring colour, because the views still paint their own colours. Phase 2 swaps each in-scope view to tokens and primitives in one pass, so no page is left half-converted, then records the rule in CLAUDE.md.

## Critical Implementation Details

- **Timing & lifecycle**: the dark-mode script must be `<script is:inline>` placed in `<head>` before the stylesheet paints. Astro bundles and defers non-inline scripts, and a deferred script causes a light flash on dark systems. Also add `<meta name="color-scheme" content="light dark">` so native scrollbars and form controls follow the mode.

## Phase 1: Foundation (tokens, dark mode, primitives, cleanup)

### Overview

Prepare everything the views need without changing their markup.

### Changes Required:

#### 1. Green accent tokens

**File**: `src/styles/global.css`

**Intent**: Give the theme one accent colour so primary actions and focus rings are recognisably "the app", in both modes.

**Contract**: Only `--primary`, `--primary-foreground` and `--ring` change; all other tokens stay neutral.
- `:root`: `--primary: oklch(0.527 0.154 150.069)`, `--primary-foreground: oklch(0.985 0 0)`, `--ring: oklch(0.527 0.154 150.069)`
- `.dark`: `--primary: oklch(0.723 0.219 149.579)`, `--primary-foreground: oklch(0.205 0 0)`, `--ring: oklch(0.723 0.219 149.579)`

#### 2. OS-driven dark mode

**File**: `src/layouts/Layout.astro`

**Intent**: Apply the `.dark` token set when the OS prefers dark, before first paint, and follow live OS changes.

**Contract**: `<html>` gets/loses the `dark` class. Add a `color-scheme` meta and an inline head script:

```astro
<meta name="color-scheme" content="light dark" />
<script is:inline>
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
  apply();
  mq.addEventListener("change", apply);
</script>
```

#### 3. Hooks alias

**File**: `components.json`

**Intent**: Make shadcn place generated hooks where CLAUDE.md says hooks live.

**Contract**: `aliases.hooks` → `"@/components/hooks"`.

#### 4. shadcn primitives

**Files**: `src/components/ui/input.tsx`, `label.tsx`, `card.tsx`, `alert.tsx` (generated)

**Intent**: Provide token-based building blocks to replace the hand-rolled markup.

**Contract**: `npx shadcn@latest add input label card alert`. Accept the new-york defaults. The CLI may add `@radix-ui/react-label` to `package.json`. If the CLI proposes changes to `global.css`, decline them or revert, so the Phase 1 token values stay authoritative.

#### 5. Remove unused badge

**File**: `src/components/ui/LibBadge.astro`

**Intent**: Delete dead starter code with hard-coded colours.

**Contract**: File deleted; no importers exist (verified in research).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- `src/components/ui/` contains `button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`, `alert.tsx` and no `LibBadge.astro`

#### Manual Verification:

- With the OS set to dark, DevTools shows `class="dark"` on `<html>` of `/auth/signin`, and toggling the OS setting flips it without reload

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Wire views to tokens and record the rule

### Overview

Replace hard-coded colours in every in-scope file with tokens and shadcn primitives, drop the cosmic look there, and document the convention.

### Changes Required:

#### 1. Form field

**File**: `src/components/auth/FormField.tsx`

**Intent**: Build the field on shadcn `Label` + `Input` so its colours, focus ring and error state come from tokens.

**Contract**: Same props. Keep the leading icon and `endContent` slots (icon uses `text-muted-foreground`; the input keeps left padding for it). On error, set `aria-invalid` on the input (shadcn's Input styles that with `destructive`), link the message via `aria-describedby`, and render the message in `text-destructive`. Remove `inputBase` and every `white/*`, `blue-*`, `purple-*`, `red-*` class.

#### 2. Submit button

**File**: `src/components/auth/SubmitButton.tsx`

**Intent**: Let the default Button variant (green primary) show through.

**Contract**: `className` keeps only layout (`w-full`); no colour, radius or padding overrides. The pending spinner uses `border-current` shades instead of `white`.

#### 3. Password toggle and server error

**Files**: `src/components/auth/PasswordToggle.tsx`, `src/components/auth/ServerError.tsx`

**Intent**: Token colours for the toggle icon; the server error becomes a shadcn `Alert`.

**Contract**: Toggle uses `text-muted-foreground hover:text-foreground`. `ServerError` keeps its `message` prop and null-return, and renders `<Alert variant="destructive">` with the `CircleAlert` icon.

#### 4. Sign-up hint colour

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Remove the last hard-coded colour in the shared form code (the password hint, `SignUpForm.tsx:59`).

**Contract**: Hint uses `text-muted-foreground`. No other change to the sign-up form.

#### 5. Config banner

**File**: `src/components/Banner.astro`

**Intent**: Render the missing-config warning with tokens instead of hex colours.

**Contract**: Renders shadcn `Alert variant="destructive"` (static, no `client:*`). Drop the unused `info`/`warning` variants and the scoped `<style>` block. Callers (`Layout.astro:23`) keep working; the `variant` prop is removed or accepts only `"error"`. The banner stays full-width at the top of the page.

#### 6. Sign-in page

**File**: `src/pages/auth/signin.astro`

**Intent**: Centered `Card` on the token background with a plain `CardTitle`, and no sign-up link.

**Contract**: Wrapper uses `bg-background` (no `bg-cosmic`), `Card` > `CardHeader`/`CardTitle` "Sign in" > `CardContent` with `<SignInForm client:load />`. The "Don't have an account? Sign up" paragraph is deleted.

#### 7. Confirm-email page

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Same Card layout; the description uses muted text; the back link is a token-styled link.

**Contract**: `Card` with the emoji, `CardTitle` heading, `CardDescription` text, and the sign-in link as `Button asChild variant="link"` wrapping `<a href="/auth/signin">`.

#### 8. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Same Card layout; the sign-out control becomes a real `Button`.

**Contract**: `Card` with title "Dashboard", the email in `font-semibold text-foreground` inside `text-muted-foreground` copy, and the sign-out `<form method="POST" action="/api/auth/signout">` containing `<Button type="submit" variant="outline">`.

#### 9. Agent rule

**File**: `CLAUDE.md`

**Intent**: Keep the next agent on the token contract.

**Contract**: Add under **Hard rules**: "Style with design tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, …, defined in `src/styles/global.css`) and shadcn component variants; never hard-code palette colours (`white/*`, `blue-500`, hex) and never pass colour classes to a shadcn component via `className` (tailwind-merge makes them override the variant). Layout classes (`w-full`, spacing) are fine. Legacy exceptions until S-09/S-04: `Welcome.astro`, `Topbar.astro`, `signup.astro`." Also add under **Architecture & conventions**: "Light/dark mode follows the OS via an inline script in `Layout.astro` that toggles `.dark` on `<html>`."

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke test passes against the dev server: `npm run smoke`
- No hard-coded palette classes remain in in-scope files: `grep -nE "(white|black|blue|purple|red|pink|indigo)-[0-9]+|white/|#[0-9a-fA-F]{3,6}|bg-cosmic" src/components/auth/*.tsx src/components/Banner.astro src/pages/auth/signin.astro src/pages/auth/confirm-email.astro src/pages/dashboard.astro` returns nothing

#### Manual Verification:

- `/auth/signin` looks right in light and in dark mode: neutral card, green "Sign in" button, visible green focus ring, no sign-up link
- Sign-in validation errors (submit empty form) and a server error (wrong password) show in destructive red, readable in both modes
- `/auth/confirm-email` looks right in light and dark mode
- `/dashboard` looks right in light and dark mode and "Sign out" still signs out

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- None; the project has no unit test runner, and this change adds no logic.

### Integration Tests:

- `npm run smoke` covers sign-up, sign-in, the protected dashboard and sign-out over HTTP. It still passes because only markup changes.

### Manual Testing Steps:

1. `npm run dev`, OS in light mode: open `/auth/signin`, submit empty, then submit a wrong password; check the card, button, focus ring and errors.
2. Sign in, check `/dashboard`, click "Sign out".
3. Open `/auth/confirm-email`.
4. Switch the OS to dark mode and repeat steps 1–3; check there is no white flash on reload.

## Performance Considerations

The inline script is a few lines and runs once per page load plus on OS changes. The React primitives used in `.astro` files render as static HTML, so they add no client JS.

## Migration Notes

Not applicable (no data or backend changes).

## References

- Related research: `context/changes/initial-ui-setup/research.md` (Decisions section)
- Token file: `src/styles/global.css:6-124`
- Token-based component pattern: `src/components/ui/button.tsx:7-33`
- Roadmap items that replace out-of-scope views: `context/foundation/roadmap.md` (S-04, S-09)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation (tokens, dark mode, primitives, cleanup)

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — e63fae8
- [x] 1.2 Type check passes: `npx astro check` — e63fae8
- [x] 1.3 Build passes: `npm run build` — e63fae8
- [x] 1.4 `src/components/ui/` contains `button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`, `alert.tsx` and no `LibBadge.astro` — e63fae8

#### Manual

- [x] 1.5 With the OS set to dark, DevTools shows `class="dark"` on `<html>` of `/auth/signin`, and toggling the OS setting flips it without reload — e63fae8

### Phase 2: Wire views to tokens and record the rule

#### Automated

- [x] 2.1 Lint passes: `npm run lint`
- [x] 2.2 Type check passes: `npx astro check`
- [x] 2.3 Build passes: `npm run build`
- [x] 2.4 Smoke test passes against the dev server: `npm run smoke`
- [x] 2.5 No hard-coded palette classes remain in in-scope files: `grep -nE "(white|black|blue|purple|red|pink|indigo)-[0-9]+|white/|#[0-9a-fA-F]{3,6}|bg-cosmic" src/components/auth/*.tsx src/components/Banner.astro src/pages/auth/signin.astro src/pages/auth/confirm-email.astro src/pages/dashboard.astro` returns nothing

#### Manual

- [x] 2.6 `/auth/signin` looks right in light and in dark mode: neutral card, green "Sign in" button, visible green focus ring, no sign-up link
- [x] 2.7 Sign-in validation errors (submit empty form) and a server error (wrong password) show in destructive red, readable in both modes
- [x] 2.8 `/auth/confirm-email` looks right in light and dark mode
- [x] 2.9 `/dashboard` looks right in light and dark mode and "Sign out" still signs out
