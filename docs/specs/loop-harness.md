# LOOP HARNESS — the build / verify / fix convention

Applies to every part of every build prompt that cites it.

## 0. Inventory first
Read `git log -20` and `git status`. For each part of the spec, check whether
it already exists in the tree (routes, components, tests). Produce a table:
part · exists? · committed? · passes its own tests? · matches reference?
Only then start, on the first row that is not done. Never redo a done row.

## 1. Definition of done is checkable, not felt
A part is done only when ALL of:
- `tsc --noEmit`, `eslint .`, `npm test`, `npm run build` are green
- the part's budget numbers are measured and within limit
- real Chromium captures (on the real GPU, per the saved method) are
  compared to the named reference image
- every item of the part's art-direction checklist is scored PASS / FAIL,
  each with the measurement that decided it

## 2. Iterate
build → gates → capture → score → list every FAIL → fix ONLY the FAILs →
repeat. Maximum 5 iterations per part. Print one table row per iteration:
iteration · fails before · fails after · what changed.
Stop the part at zero FAILs, or when 5 iterations are spent — then report the
remaining FAILs with the reason each resisted, and STOP.

## 3. No part is done on a description
A capture and a number, or it is not done.

## 4. Commit per finished part
Separate commit, measured numbers in the message. STOP after each commit and
report before starting the next part.
