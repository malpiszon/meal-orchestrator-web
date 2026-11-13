# Review fixes

- [x] F1 (impl-review-phase-1): the Phase 2 PR body tells other worktrees to run `npm install` after pulling. With the v2 CLI still installed, the hook's `migration list` (no `--local`) would query the linked production project.
