# Verification performed

## Passed in the build workspace

- `npm test`: **75 passing checks** across the backend/local API, matching, first-score/replay isolation, pack management, bulk parser, animation engine and frontend event/render flow.
- Pack management: private draft/import, exactly-seven publication checks, publish/hide, active/API play blocked while private/deleted, republish preserves the timer, deleted entries cannot be revived by save, past results and leaderboard history retained, and UI delete confirmation/cancellation.
- Unlimited replays: first-run gate, distinct replays, first-score preservation across higher/lower results, no inflated participation/games/achievements/popularity, idempotent replay requests, rejected cross-user/request-ID access, timer/resume behavior, legacy local compatibility, per-pack official slots, and replay/first-result UI switching.
- Invalid retry: invalid guesses keep the same question and deadline; blank submissions explicitly skip with zero; invalid request retries are idempotent; fresh guesses remain usable; valid or confirmed answers, blank skips and timeouts advance. Invalid raw guesses are recorded without a review requirement.
- Typo matching: `appel` → Apple, one insertion/deletion/substitution, exact-match priority, equivalent-alias spelling mistakes, no double counting aliases, ambiguous canonical matches and short-name competitors are rejected without advancing, short names/two edits/unknown phrases are not auto-accepted, suggestion requires confirmation, original deadline enforced during confirmation, corrected wording retained, canonical scores/popularity, no early results, timeout enforcement.
- Timers: 25 seconds, state reads/repeated starts preserve the deadline; explicit resume consumes the interrupted question once and starts the next; late answer scores zero, only the active question expires during a long absence.
- Submissions: question mismatch rejected, retries cannot add/alter answers, one completed attempt reused.
- Results: complete answer banks unavailable before seven answers; own locked answers, ranks and scores reveal immediately; all seven result rows returned afterward, ranks and points correct, accepted-answer banks descending, special explanations present.
- Identity and scoring: another guest cannot read an attempt through the API, name uniqueness/locking, tied ranks, canonical aliases, popularity denominator includes completed incorrect responses.
- Game Master: publication validation, alias collision rejection, unlisted-answer approval, rarity correction, preserved individual overrides, frozen played-pack structure, import creates fresh drafts.
- Remote client: anonymous signup followed by authenticated RPC; public connection credentials accepted and privileged keys rejected.
- UI flow: empty home, Game Master editor, username gate, all seven answer transitions, own-answer reveal with complete banks hidden until completion, expanded results markup, leaderboard, settings, unrecognized/all history filtering, and HTML escaping of pack text.
- `node --check` for the delivered browser scripts.
- Arcade engine VM checks: six rails, camera interpolation, golden transformation, rank crossing, visible avatar travel, extending tunnel variables, persistent gold, reduced-motion final state, gobble feedback, blank reaction pause and safe animation cancellation.
- Bulk parser: 17 checks for CSV/TSV/JSON, quoted/multiline fields, question count/ranks, alias conflicts, fresh private drafts, answer-list merging, input limits and inert text.
- Frontend integration: quoted invalid guess retry, typo confirmation, blank reaction, interrupted-run resume, clickable gobble, all seven transitions, gold persistence into the next question, archive search/filter without rerender, emoji marks, replay isolation, bulk editor autofill and pack visibility controls.
- `python3 build.py`: produces a static `dist/` site and a standalone `Councillion.html`.
- Parsed the bundled HTML: stylesheet and scripts are embedded, no external runtime assets remain, all embedded JavaScript passes Node syntax checks.
- Backend SQL static review: named RPCs and explicit grants, restricted private schema, RLS enabled, server-held deadlines, locked attempts, complete-only results. This is inspection, not a database execution result.

The UI VM checks exercise JavaScript behavior and generated markup. They do **not** verify visual browser rendering, responsive layout, screen-reader behavior, or browser storage behavior on every platform.

## Not yet verified

- Applying the SQL migration to an actual Supabase project and running `tests/backend-contract.sql`, `tests/typo-matching.sql` and `tests/answer-feedback.sql` there. PostgreSQL is not installed in this workspace.
- Live Supabase Auth, RLS and API behavior, actual concurrent requests, and two-device shared leaderboards.
- GitHub Pages deployment and public URL, because deployment integrations are administratively unavailable here.
- Visual desktop/mobile browser inspection. Chromium could not launch under this workspace’s browser restrictions, on the preceding build; this update was checked with the UI/animation VM harness. The sounds have not been listened to here. UI VM and animation tests are not a substitute for visual/audio browser verification.

Do not treat the generated backend, deployment workflow, or responsive CSS as evidence those live checks already passed. Follow README.md for setup and perform the two-browser event rehearsal before using shared scores at the get-together.
