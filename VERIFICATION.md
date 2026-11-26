# Launch update verification

## Passed in this workspace

- `npm test`: **107 passing automated checks**.
- `python3 build.py`: static `dist/` site and fully embedded `Councillion.html` generated. The static deployment fingerprints its own JavaScript/CSS files.
- Browser script syntax checks pass.
- Backend/local API regressions: aliases and typos require confirmation, confirmation keeps the original deadline and raw input, exact canonical input retains priority, invalid input stays on the same question, complete banks stay private until completion, first-run/replay isolation remains intact.
- Score moderation: removal leaves the first-run slot and answer history intact, updates both standings and answer percentages, recomputes ranks and participation, and is idempotent. UI confirmation/cancellation and authenticated remote RPC/error handling are covered.
- Game Master: practice works before any official run, public statistics exclude all author runs, previous author first runs become practice. The SQL implementation uses the private admin membership table and requires admin authorization for score controls.
- Scene: world-anchored rank baselines, camera travel, ordered rank crossing, gold at landing, hidden ruler while answering, persistent scene DOM across rerenders, inverse journey to the forest, safe cancellation and reduced motion.
- Mobile geometry: visible turkey after gold descents at seven viewport heights (246–968px) and an orientation change during flight. Viewport height/offset follows keyboard events; suggestion feedback preserves the current input DOM.
- Gobble: two quiet synthesized bird calls, no text-to-speech, no rapid-tap stacking, mute behavior and suspended-context resume. This is signal/logic verification, not a listening test.
- Existing pack management, bulk importing, review corrections, password recovery client, emoji marks, own-answer reveal and answer search checks continue to pass.

## Limits

The tests use Node and DOM/animation models. **No actual browser rendering or physical iPhone Safari run was possible**: the installed Chromium launcher points to a missing binary and browser download was blocked. Touch/keyboard layout, actual sound quality, device frame rate and physical Safari still need a device check after deployment.

The SQL migration was reviewed but not executed here; this workspace has no PostgreSQL/Supabase administration connection. `tests/launch-polish.sql` supplies rollback-only checks for a disposable Supabase project. Live auth, database permissions, cross-device shared play and applying the migration still need confirmation in the target environment.

The public website and GitHub repository were not changed by this workspace: repository access was blocked. The deliverable is the updated source package. Follow `LAUNCH-UPDATE.md` to apply the database update and trigger the existing Pages deployment.
