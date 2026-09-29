# Initial UI Setup — Plan Brief

> Full plan: `context/changes/initial-ui-setup/plan.md`
> Research: `context/changes/initial-ui-setup/research.md`

## What & Why

The app has a complete set of colour tokens in `src/styles/global.css`, but no screen uses them. Every colour is hard-coded, so changing the theme today changes almost nothing on screen. This change wires the screens we're keeping to the tokens and turns on light and dark mode. After that, later UI work (`/10x-ui`) can restyle the app by editing tokens.

## Starting Point

- The screens use a hard-coded dark "cosmic" look: purple/blue classes on a navy gradient.
- `src/components/ui/` has only `button.tsx` (whose colours are overridden anyway) and an unused `LibBadge.astro`.
- Nothing ever enables the `.dark` token set.

## Desired End State

- Sign-in, confirm-email and the dashboard use only tokens and shadcn components (`Card`, `Button`, `Input`, `Label`, `Alert`).
- The pages are light or dark depending on the OS setting, with a green accent, and switch live when the OS setting changes.
- The sign-in page no longer offers sign-up.
- CLAUDE.md tells future agents to keep using tokens and variants.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Colour modes | Light + dark, following the OS; no toggle yet | The tokens already hold both sets; a toggle can come later | Research |
| Scope | Sign-in, confirm-email, dashboard, layout banner, shared auth components | `Welcome`, `Topbar` and `signup` are replaced or removed by S-09/S-04 | Research |
| Cosmic gradients | Dropped, not tokenised | A dark gradient has no light-mode equivalent; one accent colour is simpler | Research |
| Accent | Green on `--primary`/`--ring` (green-700 light, green-500 dark) | Fits a meal app; a starting point for `/10x-ui` | Research |
| Primitives | Add `input`, `label`, `card`, `alert` | Replace the hand-rolled field, glass cards and error boxes | Research |
| Hooks alias | `components.json` → `@/components/hooks` | Match CLAUDE.md | Research |
| `LibBadge.astro` | Delete | Unused; shadcn `badge` when needed | Research |
| Verification | Existing lint/check/build/smoke + manual look in both modes | No UI test tooling yet; S-09 introduces browser tests | Plan |
| Sign-up link on sign-in | Remove now | Sign-up is disabled in production and S-09 forbids the link | Plan |
| Banner variants | Keep only the error style, as a destructive `Alert` | `info`/`warning` are unused and have no tokens | Plan |

## Scope

**In scope:** token values for the accent; the dark-mode script in `Layout.astro`; shadcn primitives; `FormField`, `SubmitButton`, `PasswordToggle`, `ServerError`, the `SignUpForm` hint colour; `Banner.astro`; `signin.astro`, `confirm-email.astro`, `dashboard.astro`; `components.json`; deleting `LibBadge.astro`; the CLAUDE.md rule.

**Out of scope:** restyling `Welcome.astro`, `Topbar.astro`, `signup.astro`; a theme toggle; gradient tokens; final visual design; Playwright or lint guards; `badge`.

## Architecture / Approach

The tokens (CSS variables in `:root` and `.dark`) feed Tailwind utilities through `@theme inline`. Components reference only those utilities or shadcn variants. A tiny inline script in `<head>` adds `.dark` to `<html>` when the OS prefers dark, so one set of markup serves both modes. shadcn's React components render as static HTML in `.astro` pages, so they add no client JS there.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation | Green tokens, OS dark mode, hooks alias, `input`/`label`/`card`/`alert`, `LibBadge` removed; screens look unchanged | shadcn CLI touching `global.css`: decline or revert its edits |
| 2. Wire views + rule | All in-scope screens on tokens in both modes; CLAUDE.md rule | Leftover hard-coded classes; caught by the grep check and the manual look |

**Prerequisites:** local dev setup working (`npm run dev`, Supabase for sign-in).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The green is a placeholder; contrast is expected to be fine (white on green-700, dark on green-500) but is only checked by eye.
- `Welcome`, `Topbar` and `signup` keep the old cosmic look until S-09/S-04, so the app looks mixed until then.

## Success Criteria (Summary)

- The three kept screens look finished in both light and dark mode, with a green accent.
- Editing a token in `global.css` visibly changes those screens.
- Lint, type check, build and smoke test stay green.
