-- Run AFTER supabase.sql in a disposable Supabase development project.
-- This integration suite inserts Auth fixtures, exercises real SQL RPCs, and
-- rolls everything back. It must run as postgres via SQL editor/psql.
-- It is NOT a static-source test and is NOT automatically executed by npm test.
begin;

-- Privileged test harness advances only a rejected guess's server deadline.
create or replace function pg_temp.expire_invalid(p_state jsonb) returns jsonb
language plpgsql as $$
begin
  if p_state#>>'{feedback,kind}'='invalid' then
    update council_private.attempts set deadline=clock_timestamp()-interval '1 second' where id=(p_state->>'id')::uuid;
    return public.council_state((p_state->>'id')::uuid);
  end if;
  return p_state;
end;
$$;


create or replace function pg_temp.assert_ok(p_ok boolean,p_message text) returns void
language plpgsql as $$begin if p_ok is distinct from true then raise exception 'TEST FAILED: %',p_message; end if; end;$$;
create or replace function pg_temp.as_user(p_id uuid,p_anonymous boolean default true) returns void
language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub',p_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','is_anonymous',p_anonymous)::text,true);
end;$$;

-- Unrelated fixture identities only; no real user is modified.
insert into auth.users(id,aud,role,email) values
 ('cc000000-0000-4000-8000-000000000001','authenticated','authenticated','council-test-1@example.invalid'),
 ('cc000000-0000-4000-8000-000000000002','authenticated','authenticated','council-test-2@example.invalid'),
 ('cc000000-0000-4000-8000-000000000003','authenticated','authenticated','council-test-3@example.invalid'),
 ('cc000000-0000-4000-8000-000000000009','authenticated','authenticated','council-test-admin@example.invalid');
insert into council_private.admin_members(user_id) values('cc000000-0000-4000-8000-000000000009');

do $$
declare
  v_pack jsonb; v_questions jsonb; v_editor jsonb; v_state jsonb; v_results jsonb;
  v_id uuid; v_attempt1 uuid; v_attempt2 uuid; v_attempt3 uuid; v_question uuid;
  v_request uuid; v_deadline bigint; v_accepted uuid; v_pending uuid; v_tiered jsonb; v_board jsonb;
  i integer; v_failed boolean;
begin
  perform pg_temp.assert_ok(council_private.normalize_answer('  KAI’SA  ')='kaisa','apostrophe/case/space normalization');
  perform pg_temp.assert_ok(council_private.normalize_answer('Café')='cafe','accent normalization');

  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000009',false);
  select jsonb_agg(jsonb_build_object('prompt','TEST FIXTURE ONLY '||g.idx,'answers',jsonb_build_array(
    jsonb_build_object('canonical','Fixture Alpha','tier','dino','aliases',jsonb_build_array('FA'),'explanation',''),
    jsonb_build_object('canonical','Fixture Gem','tier','councillion','aliases','[]'::jsonb,'explanation','This is a rollback-only test fixture.')
  )) order by g.idx) into v_questions from generate_series(1,7) g(idx);
  v_pack:=jsonb_build_object('title','ROLLBACK-ONLY FIXTURE','description','','icon','🦃','color','#BD8AFF','published',true,'questions',v_questions);
  v_editor:=public.council_admin_save(v_pack);
  v_id:=(v_editor->>'id')::uuid;
  perform pg_temp.assert_ok(jsonb_array_length(v_editor->'questions')=7,'published pack has seven questions');
  v_failed:=false;
  begin perform public.council_admin_save(null); exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'null pack payload denied');
  v_failed:=false;
  begin
    perform public.council_admin_save(v_pack||jsonb_build_object('questions',(v_questions-6)));
  exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'publishing fewer than seven questions denied');
  v_failed:=false;
  begin
    perform public.council_admin_save(jsonb_set(v_pack,'{questions,0,answers,1,explanation}','""'::jsonb));
  exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'top answer requires explanation');
  v_failed:=false;
  begin
    perform public.council_admin_save(jsonb_set(v_pack,'{questions,0,answers,1,aliases}','["fixture-alpha"]'::jsonb));
  exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'cross-answer normalized alias collisions denied');

  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000001');
  perform pg_temp.assert_ok(public.council_profile() is null,'no profile before username');
  perform public.council_enter('FixtureOne');
  v_state:=public.council_begin(v_id); v_attempt1:=(v_state->>'id')::uuid;
  v_deadline:=(v_state->>'deadline')::bigint;
  perform pg_temp.assert_ok((v_state->>'position')::integer=0 and v_state->>'status'='active','first question active');
  perform pg_temp.assert_ok(v_deadline-(v_state->>'serverNow')::bigint between 24000 and 25000,'25 second server deadline');
  perform pg_temp.assert_ok(not(v_state?'points') and not(v_state?'answers') and not(v_state?'total'),'state conceals full answer bank');
  perform pg_temp.assert_ok((public.council_next(v_attempt1)->>'deadline')::bigint=v_deadline,'next cannot reset active timer');
  v_failed:=false; begin perform public.council_results(v_attempt1); exception when insufficient_privilege then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'premature answer bank disclosure denied');
  v_failed:=false; begin perform public.council_enter('Renamed'); exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'name locked after start');
  v_failed:=false; begin perform public.council_admin_get(v_id); exception when insufficient_privilege then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'regular player denied admin access');
  for i in 0..6 loop
    if i>0 then v_state:=public.council_next(v_attempt1); end if;
    v_question:=(v_state#>>'{question,id}')::uuid; v_request:=gen_random_uuid();
    v_state:=pg_temp.expire_invalid(public.council_answer(v_attempt1,v_question,' FIXTURE—GEM ',v_request));
    perform public.council_answer(v_attempt1,v_question,'tampered retry',v_request);
    perform pg_temp.assert_ok((select count(*) from council_private.submissions where attempt_id=v_attempt1)=i+1,'submission retry stays unique');
    perform pg_temp.assert_ok((select raw_answer from council_private.submissions where attempt_id=v_attempt1 and question_id=v_question)='FIXTURE—GEM','retry cannot alter answer');
  end loop;
  perform pg_temp.assert_ok(v_state->>'status'='completed','seventh answer completes pack');
  v_results:=public.council_results(v_attempt1);
  perform pg_temp.assert_ok((v_results->>'total')::integer=700 and (v_results->>'ones')::integer=7,'perfect score 700 with seven top answers');
  perform pg_temp.assert_ok(jsonb_array_length(v_results->'questions')=7,'seven result rows');
  perform pg_temp.assert_ok(v_results#>>'{questions,0,answers,0,tier}'='councillion','answer banks sorted highest first');
  perform pg_temp.assert_ok(length(v_results#>>'{questions,0,explanation}')>0,'top answer subtitle revealed');
  perform pg_temp.assert_ok((public.council_begin(v_id)->>'id')::uuid=v_attempt1,'begin resumes single official attempt');

  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000002');
  v_failed:=false; begin perform public.council_enter('fixtureone'); exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'username uniqueness ignores case');
  perform public.council_enter('FixtureTwo');
  v_failed:=false; begin perform public.council_state(v_attempt1); exception when insufficient_privilege then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'other player attempt denied');
  v_failed:=false; begin perform public.council_results(v_attempt1); exception when insufficient_privilege then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'other player result denied');
  v_state:=public.council_begin(v_id); v_attempt2:=(v_state->>'id')::uuid;
  for i in 0..6 loop
    if i>0 then v_state:=public.council_next(v_attempt2); end if;
    v_state:=pg_temp.expire_invalid(public.council_answer(v_attempt2,(v_state#>>'{question,id}')::uuid,
      case when i=0 then 'fixture gem' else 'Unknown fixture' end,gen_random_uuid()));
  end loop;
  v_results:=public.council_results(v_attempt2);
  perform pg_temp.assert_ok((v_results->>'total')::integer=100 and (v_results->>'pendingCount')::integer=0,'unknown answers are automatically final zero');
  perform pg_temp.assert_ok((v_results#>>'{questions,0,popularity,count}')::integer=2,'canonical normalization groups answer counts');
  perform pg_temp.assert_ok((v_results#>>'{questions,0,popularity,total}')::integer=2,'completed attempt denominator');

  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000003');
  perform public.council_enter('FixtureThree');
  v_state:=public.council_begin(v_id); v_attempt3:=(v_state->>'id')::uuid;
  -- Simulate server time passing; only the privileged test harness can do this.
  update council_private.attempts set deadline=clock_timestamp()-interval '1 second' where id=v_attempt3;
  v_state:=pg_temp.expire_invalid(public.council_answer(v_attempt3,(v_state#>>'{question,id}')::uuid,'fixture gem',gen_random_uuid()));
  perform pg_temp.assert_ok(v_state->>'status'='between' and v_state->>'deadline' is null,'timeout stops between questions');
  perform pg_temp.assert_ok((select review_status from council_private.submissions where attempt_id=v_attempt3)='timeout','late answer cannot score');
  perform pg_temp.assert_ok(public.council_state(v_attempt3)->>'status'='between','refresh does not start next timer');
  v_state:=public.council_next(v_attempt3);
  v_state:=pg_temp.expire_invalid(public.council_answer(v_attempt3,(v_state#>>'{question,id}')::uuid,'Unknown fixture',gen_random_uuid()));
  -- Incomplete third attempt must not alter statistics or the leaderboard.
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000001');
  v_results:=public.council_results(v_attempt1);
  perform pg_temp.assert_ok((v_results#>>'{questions,0,popularity,total}')::integer=2,'incomplete attempts excluded from denominator');
  perform pg_temp.assert_ok(jsonb_array_length(public.council_leaderboard(v_id))=2,'incomplete players excluded from leaderboard');

  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000009',false);
  v_failed:=false; begin
    perform public.council_admin_save(jsonb_set(v_editor,'{questions,0,prompt}','"Edited after start"'::jsonb));
  exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'played pack structure locked');
  select s.id into v_pending from council_private.submissions s join council_private.questions q on q.id=s.question_id
    where s.attempt_id=v_attempt2 and q.position=1;
  perform public.council_review(v_pending,p_new_answer=>jsonb_build_object('canonical','Approved fixture','tier','grimkyle','aliases','[]'::jsonb,'explanation',''),p_note=>'Verified fixture');
  perform pg_temp.assert_ok((select count(*) from council_private.submissions where question_id=(select question_id from council_private.submissions where id=v_pending) and points=85)=1,
    'optional correction updates selected timeout without changing other attempts');
  perform pg_temp.assert_ok((select count(*) from council_private.audit_log where action='submission.review')>0,'review audit recorded');
  -- Individual override updates derived total without modifying other players.
  perform public.council_review(v_pending,p_override_points=>100,p_note=>'Explicit test award',p_apply_to_matching=>false);
  select canonical_id into v_accepted from council_private.submissions where id=v_pending;
  perform public.council_regrade_answer(v_accepted,'donovan','Regraded test fixture');
  perform pg_temp.assert_ok((select points from council_private.submissions where id=v_pending)=100,'regrading preserves explicit individual override');
  perform pg_temp.assert_ok((select tier from council_private.accepted_answers where id=v_accepted)='donovan','regrading changes canonical rank while preserving explicit override');
  v_failed:=false; begin perform public.council_regrade_answer(v_accepted,'councillion',''); exception when others then v_failed:=true; end;
  perform pg_temp.assert_ok(v_failed,'regrading to top tier requires explanation');
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000002');
  v_results:=public.council_results(v_attempt2);
  perform pg_temp.assert_ok((v_results->>'total')::integer=200,'review and override refresh result total');
  perform pg_temp.assert_ok((v_results#>>'{questions,1,popularity,count}')::integer=1,'incomplete accepted answer excluded from count');
  v_board:=public.council_leaderboard(v_id);
  perform pg_temp.assert_ok((v_board#>>'{0,score}')::integer=700 and (v_board#>>'{1,score}')::integer=200,'leaderboard derives corrected totals');
  perform pg_temp.assert_ok((v_board#>>'{1,pending}')::integer=0,'automatic scoring never creates pending scores');
  perform pg_temp.assert_ok(not has_schema_privilege('authenticated','council_private','USAGE'),'private schema inaccessible to players');
  perform pg_temp.assert_ok(not has_table_privilege('authenticated','council_private.accepted_answers','SELECT'),'answer bank inaccessible to players');
  perform pg_temp.assert_ok(not has_function_privilege('anon','public.council_results(uuid)','EXECUTE'),'unauthenticated role denied results RPC');
  perform pg_temp.assert_ok(has_function_privilege('authenticated','public.council_results(uuid)','EXECUTE'),'authenticated RPC execution granted');
  raise notice 'Councillion SQL contract tests passed. All fixtures will roll back.';
end;
$$;

-- Exercise real role grants independently of the SQL-editor owner's privileges.
do $$
declare v_pack uuid; v_first uuid; v_replay uuid; v_request uuid:=gen_random_uuid();
  v_state jsonb; v_results jsonb; v_before jsonb; v_after jsonb; v_blocked boolean; i integer;
begin
  select id into strict v_pack from council_private.packs where title='ROLLBACK-ONLY FIXTURE';
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000003');
  v_blocked:=false;
  begin perform public.council_practice(v_pack,gen_random_uuid()); exception when insufficient_privilege then v_blocked:=true; end;
  perform pg_temp.assert_ok(v_blocked,'cannot practice before finishing first run');
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000001');
  v_before:=public.council_leaderboard(v_pack);
  select id into strict v_first from council_private.attempts where pack_id=v_pack and player_id=auth.uid() and is_official;
  v_state:=public.council_practice(v_pack,v_request); v_replay:=(v_state->>'id')::uuid;
  perform pg_temp.assert_ok((v_state->>'isOfficial')::boolean=false,'practice created server-side as nonofficial');
  perform pg_temp.assert_ok((public.council_practice(v_pack,v_request)->>'deadline')::bigint=(v_state->>'deadline')::bigint,'practice retry preserves deadline');
  v_blocked:=false;
  begin perform public.council_practice(v_pack,v_first); exception when insufficient_privilege then v_blocked:=true; end;
  perform pg_temp.assert_ok(v_blocked,'cannot reuse official attempt ID for practice');
  for i in 0..6 loop
    if i>0 then v_state:=public.council_next(v_replay); end if;
    v_state:=pg_temp.expire_invalid(public.council_answer(v_replay,(v_state#>>'{question,id}')::uuid,'Unknown replay fixture',gen_random_uuid()));
  end loop;
  v_results:=public.council_results(v_replay);
  perform pg_temp.assert_ok((v_results->>'isOfficial')::boolean=false,'practice result labeled');
  perform pg_temp.assert_ok((v_results->>'officialScore')::integer=700,'first score preserved');
  perform pg_temp.assert_ok((v_results->>'total')::integer=0,'replay result has its own score');
  perform pg_temp.assert_ok((v_results#>>'{questions,0,popularity,total}')::integer=2,'practice excluded from popularity denominator');
  v_after:=public.council_leaderboard(v_pack);
  perform pg_temp.assert_ok(v_after=v_before,'practice cannot change leaderboard or counted games');
  perform pg_temp.assert_ok((public.council_begin(v_pack)->>'id')::uuid=v_first,'official begin still returns first run');
  v_blocked:=false;
  begin
    insert into council_private.attempts(player_id,pack_id,status,deadline) values(auth.uid(),v_pack,'active',clock_timestamp()+interval '25 seconds');
  exception when unique_violation then v_blocked:=true; end;
  perform pg_temp.assert_ok(v_blocked,'partial unique index prevents a second official attempt');
  v_state:=public.council_practice(v_pack,gen_random_uuid());
  perform pg_temp.assert_ok((v_state->>'id')::uuid<>v_replay,'another replay is allowed');
end;
$$;

do $$
declare v_pack uuid; v_first uuid; v_state jsonb; v_blocked boolean; v_board jsonb;
begin
  select id into strict v_pack from council_private.packs where title='ROLLBACK-ONLY FIXTURE';
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000001');
  v_blocked:=false;begin perform public.council_admin_visibility(v_pack,false);exception when insufficient_privilege then v_blocked:=true;end;
  perform pg_temp.assert_ok(v_blocked,'regular player cannot make packs private');
  v_blocked:=false;begin perform public.council_admin_delete(v_pack);exception when insufficient_privilege then v_blocked:=true;end;
  perform pg_temp.assert_ok(v_blocked,'regular player cannot delete packs');
  select id into strict v_first from council_private.attempts where pack_id=v_pack and player_id=auth.uid() and is_official;
  v_board:=public.council_leaderboard(v_pack);
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000009',false);
  perform public.council_admin_visibility(v_pack,false);
  perform pg_temp.assert_ok(jsonb_array_length(public.council_packs(false))=0,'private pack hidden from public list');
  perform pg_temp.assert_ok(jsonb_array_length(public.council_packs(true))=1,'private pack retained in admin list');
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000003');
  v_blocked:=false;begin perform public.council_begin(v_pack);exception when insufficient_privilege then v_blocked:=true;end;
  perform pg_temp.assert_ok(v_blocked,'private pack blocks direct gameplay API');
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000009',false);
  perform public.council_admin_visibility(v_pack,true);perform public.council_admin_delete(v_pack);
  perform pg_temp.assert_ok(jsonb_array_length(public.council_packs(true))=0,'deleted pack removed from admin list');
  v_blocked:=false;begin perform public.council_admin_visibility(v_pack,true);exception when others then v_blocked:=true;end;
  perform pg_temp.assert_ok(v_blocked,'deleted pack cannot be republished');
  perform pg_temp.as_user('cc000000-0000-4000-8000-000000000001');
  perform pg_temp.assert_ok((public.council_results(v_first)->>'total')::integer=700,'deletion preserves completed results');
  perform pg_temp.assert_ok(public.council_leaderboard(v_pack)=v_board,'deletion preserves score history');
end;
$$;

set local role authenticated;
do $$declare v_blocked boolean:=false; begin
  begin perform 1 from council_private.accepted_answers; exception when insufficient_privilege then v_blocked:=true; end;
  if not v_blocked then raise exception 'TEST FAILED: direct private answer-bank read permitted'; end if;
end;$$;
reset role;

rollback;
