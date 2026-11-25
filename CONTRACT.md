# Councillion browser API contract

Classic scripts: config.js, api.js, bulk.js, arcade.js, then app.js. window.CouncilAPI is a singleton service.
All methods return Promises; throw Error with a helpful message on failure.
No fabricated packs, sample trivia, player scores, or statistics are seeded.

## Constants and identity
- `tiers`: array in DESCENDING order `{id,name,points,color}`. IDs: councillion=100, grimkyle=85, donovan=60, cavaughn=30, kalen=15, dino=10.
- `mode`: synchronous property `local` or `remote`.
- `init()` -> profile `{id,username,isAdmin}` or null. Local init creates no player until enter.
- `enter(username)` -> profile. Existing identity username locked after first play, name 2–24 characters. In remote creates anonymous auth if needed.
- `getProfile()` -> profile or null.
- `configure({url,key})` -> reload required; persisted config. Public anon key only, forbid service_role/secret key. `getConfig()` -> `{url,key}` or null. `disconnect()` returns local and reloads.

## Play
- `listPacks()` -> array `{id,title,description,icon,color,published,completedCount,myAttempt:null|{id,status}}`. Published only.
- `begin(packId)` -> State. Creates or resumes one official attempt. Begins first timer immediately only on new attempt.
- `practice(packId,requestId?)` -> State. Unlimited new nonofficial attempts after the first official attempt is completed. Request UUID is the replay ID and makes retries idempotent.
- `resume(attemptId,questionId=null)` -> State. Consume the interrupted active question for zero only if its ID matches, then start next; repeated resume with the old ID is inert. Between questions, null starts the next; completed returns completed.
- `confirmAnswer(attemptId,questionId,originalText,requestId?)` -> State. Recompute the same unique match and enforce original deadline; lock the original text only if valid.
- `getState(attemptId)` -> State. Expire active overdue question without starting next.
- `startQuestion(attemptId)` -> State. Valid only between; repeated active calls return same deadline.
- `answer(attemptId,questionId,text,requestId?)` -> State. Server deadline wins; late answers timeout. Retries idempotent. Blank answer skip permitted.
- Matching: normalized exact canonical/alias match first; otherwise propose a unique one-edit (including adjacent transposition) canonical candidate with feedback.kind=suggestion,candidate,rawAnswer,message. Proposal leaves the question and original deadline unchanged; explicit confirmAnswer is required. Input >=4 normalized code points and matching spelling >=5. All nearby canonical candidates count for ambiguity, including shorter names. No match/tied candidates => active State with feedback.kind=invalid, unchanged deadline and question, no locked submission. A fresh request ID permits another guess. Own accepted matches disclose immediately; full keys stay completion-only. Same algorithm in local JS and private SQL backend; no external API.
- State `{id,packId,title,isOfficial:boolean,status:'active'|'between'|'completed',position:0..6,deadline:number|null,serverNow:number,question:null|{id,prompt},lockedCount:number}`. Own locked-answer history/scoring is returned immediately for animation; never expose unused accepted answers or another player’s submissions. Timestamps UNIX milliseconds for browser; backend may emit milliseconds directly.
- `getResults(attemptId)` -> `{attemptId,packId,title,isOfficial,officialAttemptId,officialScore,username,total,max:700,ones,pendingCount,questions:[{id,prompt,rawAnswer,canonical:null|string,points,tier:null|string,reviewStatus:'accepted'|'rejected'|'timeout' (legacy 'pending' readable),explanation,popularity:{count,total,percentage},answers:[{id,canonical,tier,points,explanation,count,percentage}]}]}`. Exactly7 question rows. Accepted answer list descending points then alphabetical. Denominator completed attempts same pack, includes incorrect answers.
- `leaderboard(packId=null)` -> array `{rank,username,score,games,ones,pending}`. Equal score same rank; deterministic alphabetical presentation ties. Completed first official attempts only; all practice attempts excluded from scores, games, achievements and popularity. Null means all packs.

## Administration
- `adminLogin(email,password)` -> profile `{id,username,isAdmin:true}` or fail. Local mode requires no login and is explicitly browser-local.
- `adminLogout()` -> no result.
- `adminList()` -> all packs, same list structure incl drafts.
- `adminGet(packId)` -> PackEditor.
- `adminSave(pack)` -> PackEditor.
- PackEditor `{id?:string,title,description,icon,color,published:boolean,questions:[{id?:string,prompt,answers:[{id?:string,canonical,tier,aliases:string[],explanation:string}]}]}`. Draft may have incomplete fields/questions; publish exactly7 nonempty prompts, each >=1 answer, 100pt answers require explanation; aliases cannot collide after normalization. New drafts UI initializes7 questions. Once any attempt exists, question/answer editing frozen; unpublishing allowed. Corrections use review RPC, no silent historic mutation.
- `adminReviews()` -> array `{id,attemptId,questionId,prompt,rawAnswer,username,reviewStatus,canonical,points,answers:[{id,canonical,tier,points}]}`. All submissions shown as history by default; unrecognized filter is optional. No new submissions require review.
- `adminReview({submissionId,answerId:null|string,reject:boolean,overridePoints?:number|null,note?:string})` -> success. Points override allowed only 0,10,15,30,60,85,100; role checked. Links existing answer to submission, affects points and popularity; log changes.
- `exportPacks()` -> array PackEditor (admin only remote).
- `importPacks(packs)` -> save validated packs as unpublished drafts with fresh IDs (admin only remote).

## Backend RPC naming
Use these public RPCs (all return JSON compatible with above, auth.uid() checked):
- council_profile() -> profile|null
- council_enter(p_username text) -> profile
- council_packs(p_admin boolean default false) -> list
- council_begin(p_pack_id uuid) -> State
- council_practice(p_pack_id uuid,p_request_id uuid) -> State
- council_state(p_attempt_id uuid) -> State
- council_next(p_attempt_id uuid) -> State
- council_answer(p_attempt_id uuid,p_question_id uuid,p_answer text,p_request_id uuid) -> State
- council_confirm_answer(p_attempt_id uuid,p_question_id uuid,p_answer text,p_request_id uuid) -> State
- council_resume(p_attempt_id uuid,p_question_id uuid) -> State
- council_results(p_attempt_id uuid) -> Results
- council_leaderboard(p_pack_id uuid default null) -> list
- council_admin_get(p_pack_id uuid) -> PackEditor
- council_admin_save(p_pack jsonb) -> PackEditor
- council_reviews() -> Review[]
- council_review(p_submission_id uuid,p_answer_id uuid default null,p_reject boolean default false,p_override_points integer default null,p_note text default '') -> JSON

The API adapter handles Supabase Auth REST and public RPCs. All score decisions remain in the local store or private SQL helpers.

Replay migration: is_official defaults true for old attempts. A partial unique index enforces one official attempt per guest/pack; practice is always inserted false by the server. council_packs returns myPractice for the latest unfinished replay.

## Pack visibility and deletion
- `adminVisibility(packId,published)` calls council_admin_visibility(p_pack_id uuid,p_published boolean); authorization required. True validates exactly seven complete prompts and keys. False hides the pack and blocks all active/new play, preserving completed results.
- `adminDelete(packId)` calls council_admin_delete(p_pack_id uuid). Marks deleted_at, unpublishes and removes it from public/admin lists without erasing history. Deleted packs cannot be saved or republished.
- Players cannot bypass visibility by calling begin/state/next/answer/practice directly. Past completed results stay accessible to their owner.

## Arcade State additions
State includes runScore:number, depth:number, hasCouncillion:boolean, history:[{questionId,prompt,rawAnswer,canonical,points,tier,explanation,reviewStatus}], lastAnswer:null|historyRow. Invalid responses additionally include feedback:{kind:'invalid',message:'"raw guess" is invalid. Try again.'}. A normal state fetch has no feedback. Blank submissions and timeouts lock a zero-point response. Fuzzy proposals return feedback:{kind:'suggestion',candidate,rawAnswer,message}; no answer locks until confirmed.
Leaderboard rows include marks:[7 emoji strings],markTiers:[7 tier IDs|null]. Overall rows use their latest completed official attempt for marks.
Admin invalid history uses type:'invalid_attempt',actionable:false,submissionId:null,answers:[]. It cannot be passed to the score-correction RPC; it is a record of what was tried. Normal submitted rows are actionable.

## Bulk and scene modules
CouncilBulk.parsePack(text,options),parseAnswers(text,options),mergeAnswers(existing,incoming),template() support safe unpublished authoring.
CouncilArcade.scene(options),mount(root),descend(options),miss(),gobble(),sound(kind,tier),unlockAudio(),setSound(bool),destroy() provide the original local animation/audio engine. A gold event means the current accepted answer earned100, while scene gold persists independently.
