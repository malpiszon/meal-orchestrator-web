---
change_id: initial-ui-setup
title: Initial ui setup
status: archived
created: 2026-09-29
updated: 2026-09-29
archived_at: 2026-09-29T20:46:17Z
---

## Notes

This is a fresh project, built on the 10x-astro-starter template. At first glance, the situation seems straightforward: the token file already exists at `src/styles/global.css`. Pay attention to the name of this file: in the course starter, it is `global.css` in the singular, not `globals.css`, which is familiar from the default generators of other frameworks.

This file contains complete `:root`, `.dark`, and `@theme inline` blocks. However, the default values are the factory, monochromatic shadcn neutral palette with zero color saturation, while the `src/components/ui/` directory contains only two files: `button.tsx` and `LibBadge.astro`. It is missing basic building blocks such as `Input` or `Card`.

What’s more, the screens provided in the starter mostly ignore this stylesheet. Instead of using classes such as `bg-primary` or `text-muted-foreground`, the components rely on hard-coded Tailwind classes. If you tell an agent in this situation to “change the theme to something more modern,” the model will modify the variable definitions in `src/styles/global.css`, but on the screen, almost nothing will change apart from the appearance of the button.

With a fresh starter, first wire the existing views up to the tokens that are already sitting unused.