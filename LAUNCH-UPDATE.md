# Install this update

1. In your existing Supabase project, open **SQL Editor → New query**. Paste the entire contents of `upgrade-launch-polish.sql` and click **Run**. This preserves your packs, players and answer history. It also changes existing Game Master runs to practice and enables alias confirmation and protected score removal.
2. Unzip the update. Open the inner `councillion` folder. Upload its contents into the **root** of your existing `GrimKyle/councillion` GitHub repository, replacing the matching files. `index.html`, `api.js`, `app.js` and `build.py` belong next to your current README, rather than in another nested `councillion` folder. Keep the existing `.github/workflows/pages.yml` workflow (the included copy uses the same repository variables).
3. Commit to `main`. Wait for **Actions → Publish Councillion** to finish, then open `https://grimkyle.github.io/councillion/`. Your existing `COUNCIL_SUPABASE_URL` and `COUNCIL_SUPABASE_ANON_KEY` repository variables still configure the shared site. The build fingerprints scripts and styles so new deployments replace cached assets on phones.

Friends only need the website link and a username. They do not configure Supabase.

## What changed

- Rank lines stay attached to actual depths in the burrow. They are hidden while answering, appear during the descent, and glow in order as the turkey crosses them. The camera follows the world and the bird; inserting the reveal no longer resets either one.
- The answer travels in a small text box below the turkey. The result and Councillion subtitle appear after landing. Burrow Again fades the reveal and reframes the same scene for the next question.
- Aliases and unique typo corrections ask “Did you mean …?” before they are locked. Choose **Yes, use …** or **Keep typing**. The original 25-second deadline continues.
- Completing a pack animates the trip back to the original forest, then reveals the score and answer archive.
- **Game Master → Player scores** lists completed runs. **Delete score** removes one run from the pack leaderboard, overall totals, participation count and answer percentages. Its answers remain in history and its original first-run slot remains occupied. Unlimited practice still works, but it cannot earn a new official score.
- Signed-in Game Master accounts automatically play practice runs. Existing runs by accounts in `council_private.admin_members` are also excluded from public standings.
- The fixed game viewport follows the visible keyboard viewport. Inputs use 16px type to avoid iPhone focus zoom; buttons respect safe areas and use touch targets. Portrait/landscape rules, orientation changes during descent, reduced motion and shared audio-context resume are handled.

## Verification and remaining live checks

`npm test` passes 107 automated checks. The build and browser-script syntax checks also pass. These checks exercise the game logic, frontend flow and scene geometry, including seven viewport heights and a mid-flight rotation.

The workspace has no working browser executable; browser installation was blocked. Actual Safari rendering, physical iPhone keyboard/audio behavior and sustained frame rate have not been measured here. Run one full pack on an iPhone after deploying, including an alias, a gold answer, rotation, final return and Game Master practice. Check that a second phone sees the published pack and shared leaderboard.

The SQL migration was inspected here but could not be executed against your live database. `tests/launch-polish.sql` provides rollback-only database checks for a disposable Supabase project. Run it there as postgres after installing the migration; do not use test fixtures in the event database.

For a fresh Supabase project use the complete `supabase.sql`. Existing projects use the smaller `upgrade-launch-polish.sql` above. Running older gameplay upgrade files afterward would restore older behavior.
