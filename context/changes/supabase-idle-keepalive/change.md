---
change_id: supabase-idle-keepalive
title: Supabase idle keepalive
status: implementing
created: 2026-09-25
updated: 2026-09-26
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **2026-09-26 (user decision):** Progress 2.5 (Supabase project stays Active through ≥ 7 consecutive idle days) is impractical to verify soon — the user will be actively working on the project in the coming days, so a clean 7-day idle window is unlikely to occur on demand. User decided: once the first scheduled cron run (Progress 2.4) is confirmed successful (`keepalive ok` in Workers logs), that is accepted as sufficient practical evidence and `roadmap.md`'s F-02 status moves to `done`. 2.5 stays unchecked in `plan.md` and can be verified opportunistically if a real idle week occurs later.
