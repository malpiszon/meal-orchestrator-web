---
date: 2026-09-29T21:25:35+02:00
researcher: Claude (claude-opus-5-5) for alan
git_commit: 55a6d05
branch: master
repository: malpiszon/meal-orchestrator-web
topic: "Current UI state vs the initial-ui-setup notes (tokens, shadcn components, views wired to tokens)"
tags: [research, codebase, ui, design-tokens, tailwind, shadcn, global-css]
status: complete
last_updated: 2026-09-29
last_updated_by: Claude (claude-opus-5-5) for alan
last_updated_note: "Recorded user decisions resolving Open Questions 1–5 (see Decisions)"
---

# Research: Current UI state vs the initial-ui-setup notes

**Date**: 2026-09-29T21:25:35+02:00
**Researcher**: Claude (claude-opus-5-5) for alan
**Git Commit**: 55a6d05 (working tree: only `CLAUDE.md` modified; no `src/` changes)
**Branch**: master
**Repository**: malpiszon/meal-orchestrator-web

## Research Question

Check the project's status against the claims in `context/changes/initial-ui-setup/change.md` (Notes): the token file exists and is complete, the palette is the stock neutral one, `src/components/ui/` holds only two files, and the views ignore the tokens, so a theme edit would barely show.

## Summary

The notes are **correct on every claim**, and the code is a little worse than they describe:

1. **Token file**: `src/styles/global.css` (singular) exists and has complete `:root` (lines 6–39), `.dark` (41–73) and `@theme inline` (75–111) blocks. `components.json` points shadcn at it (`tailwind.css: "src/styles/global.css"`, `baseColor: "neutral"`).
2. **Palette**: this is the stock shadcn neutral palette. Chroma is `0` for every surface, text, primary/secondary/muted/accent, border, input and ring token in both modes. The only tokens with chroma are `--destructive`, `--chart-1..5` and, in `.dark` only, `--sidebar-primary` (`global.css:22,26-30,56,60-64,67`).
3. **Components**: `src/components/ui/` holds exactly two files, `button.tsx` (stock shadcn new-york Button, token-based) and `LibBadge.astro` (hard-coded blue/purple, **imported nowhere**). There is no `Input`, `Label`, `Card`, `Alert` or similar.
4. **Views ignore tokens**: a grep for token utilities (`bg|text|border|ring|outline-{background,foreground,primary,secondary,muted,accent,destructive,card,popover,input,ring,border}`) finds **zero** matches in `src/` outside `src/components/ui/`. Every view uses hard-coded `white/*`, `blue-*`, `purple-*` and `red-*` classes on a custom `bg-cosmic` hex gradient.
5. **Refinement: even the button would not change.** The notes say only the button would change after a theme edit. But the one place `Button` is used, `SubmitButton.tsx:18`, passes `bg-purple-600 … text-white hover:bg-purple-500`, and `cn()`/tailwind-merge lets that override the variant's `bg-primary text-primary-foreground`. A theme edit in the inspected views would therefore visibly change only the submit button's focus ring (`focus-visible:ring-ring/50` is not overridden) and the global `outline-ring/50` outline. The `body` background token (`global.css:122`) is covered by a full-screen `bg-cosmic` wrapper on every page.
6. **Dark mode is unreachable**: nothing in `src/` adds the `dark` class (grep for `dark` outside `dark:` variants found nothing), so the `.dark` block is dead code today, even though the whole app *looks* dark because it is hard-coded.

Conclusion for planning: the notes' first step, "wire the existing views up to the tokens already sitting unused", is supported. It needs the missing shadcn primitives (at least `input`, `label`, `card`) and a decision about the dark "cosmic" look, because the current dark visuals come from hard-coded classes, not from `.dark`.

## Detailed Findings

### Token file (`src/styles/global.css`)

- `@import "tailwindcss"` and `@import "tw-animate-css"`, plus `@custom-variant dark (&:is(.dark *))` (`global.css:1-4`).
- `:root` defines `--radius: 0.625rem` and 31 color tokens (`global.css:6-39`). `.dark` redefines the color tokens (`global.css:41-73`).
- `@theme inline` maps each token to a `--color-*` / `--radius-*` theme variable (`global.css:75-111`), so utilities like `bg-primary` and `text-muted-foreground` exist and just aren't used.
- There is one non-token custom utility: `@utility bg-cosmic` with hard-coded hex `#0a0e1a → #0f1529 → #0a0e1a` (`global.css:113-115`). Every page wrapper uses it.
- Base layer: `* { @apply border-border outline-ring/50 }` and `body { @apply bg-background text-foreground }` (`global.css:117-124`).
- `Layout.astro:2` imports the stylesheet. It is the only layout (`src/layouts/`).

### shadcn setup

- `components.json`: style `new-york`, `rsc: false`, `baseColor: neutral`, `cssVariables: true`, `iconLibrary: lucide`. Aliases: `ui → @/components/ui`, `utils → @/lib/utils`, **`hooks → @/hooks`**. The last one conflicts with CLAUDE.md, which says hooks go in `src/components/hooks/`, and neither directory exists yet.
- Installed deps: `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, `tailwindcss` ^4.2.4 (`package.json`). No other `@radix-ui/*` packages yet. `npx shadcn add` will install them per component.

### Views and components: token usage

Files that contain hard-coded palette literals (`white/`, `blue-*`, `purple-*`, `red-*`, `pink-*`, `indigo-*` or hex), with the count of matching lines, from grep over `src/**/*.{astro,tsx}`:

| File | Lines with literals | Role |
|------|---------------------|------|
| `src/components/Welcome.astro` | 16 | Starter hero on `/` (orbs, star field, "10x Astro Starter" copy, links to sign-up) |
| `src/components/Banner.astro` | 9 | Config-missing banner; scoped `<style>` with hex colors (`Banner.astro:27-41`) |
| `src/components/Topbar.astro` | 7 | Used only by `Welcome.astro:2` |
| `src/components/auth/FormField.tsx` | 5 | Hand-rolled input (`inputBase`, `FormField.tsx:5-6`), label, error text |
| `src/pages/dashboard.astro` | 5 | Glass card, gradient heading, raw `<button>` for sign-out (`dashboard.astro:18-23`) |
| `src/pages/auth/signin.astro` / `signup.astro` / `confirm-email.astro` | 4 each | Same glass-card + gradient-heading markup, repeated three times |
| `src/components/auth/SubmitButton.tsx` | 2 | Overrides Button colors (`SubmitButton.tsx:18`) |
| `src/components/ui/LibBadge.astro` | 2 | Unused |
| `ServerError.tsx`, `PasswordToggle.tsx`, `SignUpForm.tsx` | 1 each | Error box `red-*`, icon `white/40`, hint `blue-100/50` |

Token-utility matches outside `src/components/ui/`: **0**.

Repeated patterns that the missing primitives would replace (inferred from the markup above):
- **Card**: `rounded-2xl border border-white/10 bg-white/10 p-8 backdrop-blur-xl` in 4 pages (`dashboard.astro:9`, `signin.astro:10`, `signup.astro:10`, `confirm-email.astro:23`), plus the `rounded-xl … bg-white/5` variant in `Welcome.astro` and `Topbar.astro:5`.
- **Gradient heading**: `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-transparent` in the same 4 pages.
- **Input + Label**: `FormField.tsx`.
- **Alert (destructive)**: `ServerError.tsx:11` and the `Banner.astro` error variant.
- **Button**: `SubmitButton` (overridden) and two raw `<button>`s (`dashboard.astro:18`, `Topbar.astro:14`) plus link-styled anchors (`Welcome.astro:29-40`).

### Views in the app today

Pages found (`src/pages/**/*.astro`): `/` (`index.astro` → `Welcome`), `/dashboard`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`. All of them render through `Layout.astro`, and each one wraps its content in `bg-cosmic`.

## Code References

- `src/styles/global.css:6-39` - `:root` tokens (neutral, chroma 0 except destructive/charts)
- `src/styles/global.css:41-73` - `.dark` tokens (unreachable: no `dark` class applied)
- `src/styles/global.css:75-111` - `@theme inline` mapping
- `src/styles/global.css:113-115` - `bg-cosmic` hard-coded gradient utility
- `src/styles/global.css:117-124` - base layer applying `border-border`, `outline-ring/50`, `bg-background`, `text-foreground`
- `components.json` - shadcn config (new-york, neutral, css at `src/styles/global.css`, hooks alias `@/hooks`)
- `src/components/ui/button.tsx:7-33` - token-based cva variants
- `src/components/auth/SubmitButton.tsx:15-19` - only Button consumer; overrides `bg-primary` with purple
- `src/components/auth/FormField.tsx:5-6,37,41,53,59` - hand-rolled input styling
- `src/components/ui/LibBadge.astro:10-12` - unused, hard-coded colors
- `src/components/Banner.astro:15-41` - hex colors in scoped CSS
- `src/layouts/Layout.astro:2,10` - stylesheet import; default title "10x Astro Starter"

## Architecture Insights

- The token pipeline (CSS vars → `@theme inline` → utilities) is complete and correct for Tailwind 4 + shadcn. The gap is entirely on the consumer side.
- The current look is one dark, glassy, purple/blue "cosmic" theme that is hard-coded, not token-driven. Wiring views to tokens will visually **flip the app to light neutral** (the `:root` values), unless the plan also chooses a palette and/or sets `dark` on `<html>`. That is a product choice (see Open Questions).
- `cn()` and tailwind-merge are why className overrides silently win over variants. Consumers passing color classes to shadcn components will defeat the tokens, so a rule to "use variants, don't pass colors" belongs with this change.
- The roadmap's S-09 (`landing-page`) will replace `Welcome.astro`/`Topbar.astro` on `/` and S-04 removes sign-up. Effort spent restyling `Welcome.astro`, `Topbar.astro` and `signup.astro` may be discarded soon (`context/foundation/roadmap.md`, S-04 and S-09 entries).

## Historical Context (from prior changes)

- Not applicable: grep over `context/**/*.md` for design-system/theme/token/shadcn/palette/dark-mode decisions found no UI decisions. The only matches were auth/API tokens in `context/deployment/deploy-plan.md` and `context/foundation/infrastructure.md`. The other changes (`bootstrap-verification`, `supabase-idle-keepalive`) are not UI-related.
- `context/foundation/roadmap.md` Baseline says: "Frontend: present … only starter pages exist (landing page, placeholder dashboard, auth forms)". This is **supported** by the page inventory above.
- `context/foundation/lessons.md`: not present.

## Related Research

None. This is the first UI research in `context/changes/` or `context/archive/`.

## Decisions (2026-09-29, user-confirmed)

These resolve Open Questions 1–5 below.

1. **Both light and dark modes, following the OS preference.** An inline script in `<head>` of `Layout.astro` reads `prefers-color-scheme` and sets `class="dark"` on `<html>` before first paint, so the page doesn't flash. No manual toggle yet. Views must use token utilities only, so both modes render correctly.
2. **Scope:** wire `/auth/signin`, `/auth/confirm-email`, `/dashboard`, `Layout.astro`, `Banner.astro` and the shared auth components (`FormField`, `ServerError`, `SubmitButton`, `PasswordToggle`). **Out of scope:** `Welcome.astro`, `Topbar.astro` and `signup.astro`, which S-09 replaces and S-04 removes. `signup.astro` still picks up the shared auth components' changes for free.
3. **Drop `bg-cosmic` and the gradient headings.** Pages use `bg-background` and headings use `text-foreground`. Personality comes from a single accent colour in `--primary` instead. `bg-cosmic` can be removed from `global.css` once no in-scope view uses it; if out-of-scope `Welcome.astro` still needs it, it stays until S-09.
4. **Accent colour: green** (starting point, to be revisited with `/10x-ui`), set on `--primary` and `--ring`:
   - light: `--primary: oklch(0.527 0.154 150.069)` (Tailwind green-700), `--primary-foreground: oklch(0.985 0 0)`
   - dark: `--primary: oklch(0.723 0.219 149.579)` (Tailwind green-500), `--primary-foreground: oklch(0.205 0 0)`
   - `--ring` follows the same hue in each mode. All other tokens stay neutral.
5. **shadcn primitives to add** (via `npx shadcn@latest add`): `input`, `label`, `card`, `alert`, plus `badge` only if an in-scope view needs it. Consumers use component variants, not colour classes passed through `className`; this rule goes to CLAUDE.md so the next agent keeps it.
6. **Hooks alias:** change `components.json` `aliases.hooks` to `@/components/hooks` to match CLAUDE.md.
7. **Delete `src/components/ui/LibBadge.astro`** (unused). A shadcn `badge` replaces it when a feature needs one (e.g. S-02's recency note).

## Open Questions

All five below are resolved by **Decisions** above; kept for history.

1. **Target look after wiring**: keep a dark theme (set `class="dark"` on `<html>` and tune the `.dark` tokens toward the current cosmic look), switch to light neutral, or pick a new brand palette now? This decides whether the change is "wire only" or "wire + retheme". Owner: user.
2. **Scope vs roadmap**: should `Welcome.astro`, `Topbar.astro` and `signup.astro` be wired now, or left alone because S-09 and S-04 will replace or remove them? Owner: user.
3. **`bg-cosmic` and the gradient headings**: turn them into tokens (for example a `--gradient-*` or brand accent token), or drop them? Owner: user.
4. **Hooks alias conflict**: `components.json` `hooks: @/hooks` vs CLAUDE.md `src/components/hooks/`. Align one of them before shadcn generates a hook. Owner: user.
5. **`LibBadge.astro`**: unused. Delete, or keep as a Badge seed? Owner: user.
