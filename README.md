# Councillion

An actual playable pack-based trivia website for The Council. Seven questions per pack, 25 seconds per question, six manually assigned rarity tiers, and a maximum of 700 points. No AI-generated trivia or AI scoring; the Game Master writes the content.

## Open the website now

Open **Councillion.html** in your browser. It contains the entire application and needs no installation. Start with **Game Master → Create pack**, write your seven questions and accepted answers, then publish. Go back to **Packs**, enter a username, and play.

The initial pack list is intentionally empty. No invented friends, fabricated leaderboard entries, or AI-written questions are included.

**Before connecting Supabase, this is explicitly a local host edition.** It saves packs, progress, results, and scores on that browser only. Local Game Master tools are open because there is no remote administrator account. It does not claim secure shared competition. Export authored packs from Game Master before clearing browser storage.

## Make it shared across everyone's phones

The website and backend are written. A public URL and a configured Supabase project are not provisioned by this package. The hosting integrations were unavailable in the build workspace. Follow these setup steps once; nobody playing needs an email or password.

### 1. Create the Supabase backend

1. Create a project at https://supabase.com/dashboard.
2. In its SQL editor, run all of `supabase.sql` once. The migration stores game data and answer keys in a private schema. Do **not** add `council_private` to the exposed Data API schemas.
3. In Authentication settings enable **anonymous sign-ins**. Each player gets a persistent guest session behind their chosen username.
4. In Authentication → Users create your own permanent email/password user. Confirm the email or mark it confirmed through the dashboard.
5. Copy that user's UUID. Run this SQL with your UUID substituted:

   ```sql
   insert into council_private.admin_members(user_id)
   values ('YOUR-PERMANENT-USER-UUID'::uuid)
   on conflict do nothing;
   ```

6. Copy your project URL and **public publishable key** (or legacy **anon** key) from Project Settings → API. Never put a service-role/secret key in this website, a pack, or a GitHub variable.
7. In the website choose **Connection settings**, enter those two public values, and connect. Use **Game Master** to log in with your permanent account.

Anonymous users are not Game Masters. The backend checks the permanent account and server-stored admin membership for every administrative operation. Scores are computed in PostgreSQL; the client cannot submit point values through the game endpoint.

If friends will all connect over one Wi-Fi network, check the project's anonymous signup IP rate limit before the event. Supabase documents a default rate limit and recommends abuse protection; plan for your group size. Adding CAPTCHA requires frontend integration rather than simply switching it on. Official guidance: https://supabase.com/docs/guides/auth/auth-anonymous.

### 2. Put the site on GitHub Pages

1. Create a GitHub repository and upload this folder's **contents**, including the `.github/workflows/pages.yml` file. Do not place everything inside an extra folder in the repository.
2. Under Settings → Secrets and variables → Actions → **Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `COUNCIL_SUPABASE_URL` | Your HTTPS Supabase project URL |
   | `COUNCIL_SUPABASE_ANON_KEY` | Your public publishable/anon key |

3. Under Settings → Pages, choose **GitHub Actions** as the publishing source.
4. Push to the `main` branch or run **Publish Councillion** manually in Actions.
5. Open the published URL shown by the successful workflow. Every friend's browser automatically uses the shared backend; they should not need connection settings.

All asset references are relative, so GitHub Pages project URLs work without route rewrites. Navigation happens within the application. No always-running Node server is required. The workflow builds with Python and runs the dependency-free Node tests.

You can also edit `config.js` with the two **public** values and host `index.html`, `styles.css`, `arcade.css`, `config.js`, `api.js`, `bulk.js`, `arcade.js`, and `app.js` on any static host. With both connection values left blank, it remains local-only.

### 3. Move locally authored packs to the shared site

Export each local pack as JSON from Game Master. Connect to Supabase, log into Game Master, import the JSON, review it, and publish it. Importing creates a new draft; it does not silently move browser-local scores into the shared leaderboard.

## Your pack workflow

1. In **Game Master**, choose **Create pack**, or **Upload pack** to import a saved Councillion JSON pack.
2. Enter exactly seven questions, their accepted answers, aliases, rarity tiers and top-answer explanations. Incomplete work can remain a private draft.
3. Choose **Publish pack**. On the connected shared site, everyone sees it immediately—there is no GitHub upload or redeployment for each pack.
4. Use **Make private** to hide it and stop new or resumed play. Use **Publish pack** to reopen it later.
5. Use **Delete** to remove it from the website after confirmation. Deletion removes the pack from both the public and normal Game Master lists and blocks gameplay. It retains stored past submissions, completed results and score history, including historical overall leaderboard totals; it is not a permanent database purge.

For an existing backend, install `upgrade-pack-management.sql` after the earlier typo/replay upgrades, then deploy the updated frontend. New installations only need the current `supabase.sql`. Administrative permission checks are enforced on the backend. The local host edition still has open local editing and does not make changes across devices.

## Arcade update and bulk authoring

- The game now fills the viewport with an original pixel forest and underground burrow. Accepted answers animate the camera through dirt, stone, crystals and the deep cavern. Each point adds ten metres, up to 7,000m.
- The six rank thresholds glow and play ascending synthesized notes. The turkey trots and kicks up dirt. A 100-point answer transforms it into gold with a fanfare, sparkles and its Game Master explanation; the turkey stays golden for the remainder of that run. Reduced-motion users receive an immediate final state instead of the camera animation.
- Invalid guesses **do not advance** the question or restart the 25-second timer. Players can submit another guess. A valid answer or timeout locks the question. Invalid guesses are saved in the host’s nonactionable history, without a review requirement.
- Your own accepted answer and its score/rank reveal immediately. Full ranked answer lists unlock after question seven. The final reveal stays visible until **See your results** is chosen.
- Search the final answer archive by answer text, rank or explanation. Matching cards open automatically; the input keeps focus as you type.
- Usernames accept pasted emoji. Pack leaderboards show seven result squares: Councillion 🟨, Grimkyle 🟪, Donovan 🟧, Cavaughn 🟦, Kalen 🟩, Dino ⬜, timeout ⬛. Overall leaderboards show the latest official run’s marks next to its cumulative score. Replays remain excluded from official totals.
- In Game Master choose **Paste / CSV import** for a full pack, or **Paste answer list** inside a question. Simple lists use the rank you select. CSV/TSV rows can supply different ranks, aliases and explanations. Imported content stays private in the editor until you publish.
- Download a blank CSV template from the import dialog, open it in Excel, and save as CSV UTF-8. CSV, TSV and JSON are supported; native `.xlsx` files are not read directly. See `BULK-IMPORT.md` for column details. The template contains no generated trivia.

**Existing Supabase installations:** apply `upgrade-arcade-gameplay.sql` after the earlier pack-management/replay/typo upgrades, then deploy the updated frontend assets. The new upgrade preserves old attempts/scores and adds private invalid-guess logs. New projects need only the latest `supabase.sql`. Live PostgreSQL execution still needs verification in your own project.

## Playing

- Anyone with the website link can choose an available 2–24-character username. No player registration form.
- Each pack contains exactly seven questions. A recognized answer locks immediately. Invalid or ambiguous guesses are rejected and let the player retry on the same unchanged timer; reaching the server's 25-second deadline locks a timeout with zero points.
- The next timer starts when the player chooses the next question. Each accepted answer immediately reveals its own rank and score during an animated descent. Other accepted answers remain hidden until all seven questions are finished.
- Refreshing cannot restart an active server deadline. Returning after a long interruption times out only the question that had started; it does not consume the remaining pack.
- Your first run of each pack is your only leaderboard attempt. Once it finishes, unlimited replays unlock. Every replay has its own result; higher or lower replay scores never replace the first score. Both pack and overall rankings count first runs only. The 25-second timer still applies to every question.
- Completed packs show **View first-run results** and **Replay pack**. Unfinished replays can be resumed; returning to an interrupted question locks zero for it and starts the next one. The first-run score slot stays the same. Replays do not count toward popularity statistics or official participation totals.
- After seven locked questions, the player sees their total and can expand each question's full accepted-answer list, grouped highest to lowest.
- A 100-point answer reveals the Game Master's explanation with a golden turkey celebration. Sound starts enabled for new users and begins after a user gesture; the sound button mutes it immediately. Existing saved sound preferences are retained; reduced-motion preferences are respected.
- Every pack has a leaderboard; the overall board sums completed packs. Equal scores share a rank. Names order tied rows consistently.
- Popularity counts canonical answers and aliases together. Its denominator is the number of **completed official guest attempts for that pack**, including players with incorrect or timed-out responses.

## Game Master

- Create a seven-question draft, edit prompts, add accepted answers/aliases, assign rarity, and supply an explanation for each One in a Councillion answer.
- Publish/unpublish packs, import/export authored content, and view each pack's completion count.
- Once anyone starts a pack, its question structure and answer spellings are frozen. Make a new pack for new questions. This preserves what people actually played.
- Browse **Answer history** to see exactly what every player typed. Scoring is automatic and no approval is required. Optional corrections let you map an unrecognized submission to an existing answer, add a canonical answer, or override a score. A manually approved spelling can be remembered as an alias for future submissions.
- Apply a rarity correction to an existing accepted answer. All matching historical scores update, except explicit individual overrides. Revisit/refresh results and leaderboards to see corrections.
- The backend records administrative changes in `council_private.audit_log`. The full audit-log viewer and long-term player profile statistics from the original daily-game brief are not implemented in this pack edition.

The tiers are Dino 10, Kalen 15, Cavaughn 30, Donovan 60, Grimkyle 85, One in a Councillion 100. Unrecognized, ambiguous and incorrect guesses are rejected without advancing. Players can retry until the original deadline; a timeout or explicitly submitted blank answer locks zero points. No submission waits for approval. Popularity never automatically changes a tier.

Matching checks deterministic normalization and configured aliases first. Case, whitespace, punctuation, apostrophes, and common combining accents are normalized. It then proposes a **single unique typo match** and asks **Did you mean “…”?**. The player must confirm before it locks. The original timer continues while deciding. Matching permits one adjacent letter swap (such as `appel` → `Apple`), insertion, deletion, or substitution against an accepted answer or alias. Submitted text must have at least four normalized characters, and the matching accepted spelling must have at least five. Shorter names require exact matching or an explicit alias. Several matching aliases for the same canonical answer count as one candidate. If two different answers are within one edit, even a shorter competing name, the guess is rejected and the player can try again until time expires. Two-edit mistakes and semantic equivalents without configured aliases are also rejected. Every game finishes and scores without Game Master action. A typo proposal can still resemble an unintended name, so players must confirm it; the Game Master can correct any submission through Answer history, but this is entirely optional.

`red apple` → `Apple` still needs `red apple` as an alias. Once configured, a typo like `red appel` can also be recognized. Corrections retain what the player actually typed and use the canonical answer's fixed rarity and popularity count. Only the player’s own locked matches are disclosed during play; the complete answer bank remains hidden until the pack is finished. No AI API is used.

### Updating a previously installed site for unlimited replays

Run `upgrade-unlimited-replays.sql` in Supabase SQL Editor, then deploy the updated frontend files. It preserves every existing attempt as the official first run and creates a separate slot for each replay. Run the earlier `upgrade-typo-matching.sql` first if you have not installed automatic typo matching yet. New installations only need the updated `supabase.sql`, which includes both changes. The upgrade is written but has not been executed against a live Supabase project in this workspace.

### Updating a previously installed site for typo correction

- **Local standalone:** replace your old file with the updated `Councillion.html`. Keep the same file location/name if possible; export your local packs first because browser storage handling for local files varies.
- **Existing Supabase project:** run `upgrade-typo-matching.sql` once in SQL Editor. It replaces matching/scoring helpers without deleting packs, players, or submissions. New projects can just run the updated `supabase.sql`, which already includes it.
- **Hosted frontend:** replace `api.js` and `app.js`, or upload the updated project and run your publishing workflow. Keep your existing public connection configuration.
- Existing locked answers and historical scores are preserved. The update affects newly submitted answers. Legacy pending entries from an older version can still be inspected and optionally corrected in Answer history.
- Database execution is still unverified in this workspace. Run the SQL contract tests in a disposable development project before relying on the live backend.

## Identity and reveal limits

Guest sessions are remembered by the browser. Clearing site data or using another browser creates another identity; usernames alone cannot prove one attempt per human or recover a lost session. This is the agreed casual, username-only entry model. There is no device-fingerprinting or fake guarantee of human uniqueness.

After finishing, a player is deliberately allowed to see every answer. They could share those answers with friends or use a new identity. The backend protects unfinished identities from the complete answer bank and other players’ submissions; it cannot make a revealed answer secret again.

## Run and verify

No npm packages are needed. The frontend uses plain browser JavaScript rather than the originally preferred React/TypeScript/Vite/Tailwind stack, because package downloads were blocked in the build environment. This keeps the delivered site directly runnable and independently testable. Its API boundary separates the interface from the game backend.

```sh
npm test
python3 build.py
python3 -m http.server 4173 --directory dist
```

Then open http://localhost:4173. Or just open the bundled `Councillion.html` directly for local use.

### Verification status

See `VERIFICATION.md` for the checks actually executed and remaining deployment checks. `tests/backend-contract.sql` is a rollback-only Supabase SQL contract/security check. Read its fixture requirements before executing it in a project you control. The migration and live Supabase integration still need execution against your configured project; they are not represented as tested merely because SQL was written.

The local host edition is not a substitute for that live verification. Before the get-together, test with two different browsers: create/publish a pack as Game Master, finish it as two guests, confirm scores appear immediately without approvals, and confirm both browsers see the same shared leaderboard.

## Files

| File | Purpose |
| --- | --- |
| `Councillion.html` | Entire website bundled into one directly openable file |
| `index.html`, `styles.css`, `arcade.css`, `app.js`, `arcade.js` | Pixel interface, animated burrow, synthesized audio and game screens |
| `bulk.js`, `pack-template.csv`, `BULK-IMPORT.md` | Bulk authoring and Excel-compatible imports |
| `api.js` | Guest sessions, backend client, local host mode |
| `config.js` | Public Supabase connection settings for hosted visitors |
| `supabase.sql` | Database, authorization, scoring, deadlines, reviews and RPCs |
| `build.py` | Static site and standalone-file builder |
| `.github/workflows/pages.yml` | Tests and GitHub Pages publishing |
| `tests/` | Actual game tests and backend deployment checks |

Councillion artwork is original pixel geometry; no Krillion assets or source were copied. The project contains no third-party runtime libraries or paid AI APIs.

### Latest update: descent, corrections and interrupted questions

- The bird now moves downward against a stationary rank ruler on the right. Terrain scrolls independently, and the tunnel extends to the bird with an animated digging edge and flying dirt. Each crossed tier glows and plays its note.
- A blank submission skips for zero with a short stumble, sound and 850ms pause. The next timer only starts when you continue. Invalid answers instead say `"your guess" is invalid. Try again.` and preserve the current clock.
- Fuzzy spellings prompt `Did you mean “Apple”?` with **Yes, use Apple** and **Keep typing**. Exact accepted answers and explicit aliases still submit directly. Confirmation cannot beat an expired deadline.
- Click or keyboard-activate the turkey for a hop, **GOBBLE!** bubble and gobble sound/voice. The sound toggle also mutes it. Reduced-motion preferences are respected.
- Returning to an interrupted run consumes the active question for zero, then starts the next. Resume compares the interrupted question ID, so a retried resume cannot skip a second question. Simply fetching state does not consume questions.
- Leaderboard symbols represent all seven answer scores, with a point legend and question-by-question labels. Overall standings show symbols from the most recently completed official pack.

**Existing Supabase backend:** run `upgrade-answer-feedback.sql` **after** `upgrade-arcade-gameplay.sql`, then deploy the updated frontend. This adds confirmation and resume RPCs and preserves all packs and past scores. A new backend only needs the latest `supabase.sql`. Local standalone play needs no SQL update.
