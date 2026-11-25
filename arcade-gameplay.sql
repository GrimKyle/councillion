-- Run in a disposable Supabase project as postgres, after the current migration.
-- Real SQL behavior checks; every fixture rolls back. Not run by npm test.
begin;
create or replace function pg_temp.arcade_assert(p_ok boolean,p_message text) returns void
language plpgsql as $$begin if p_ok is distinct from true then raise exception 'ARCADE TEST FAILED: %',p_message; end if; end;$$;
insert into auth.users(id,aud,role,email) values('cc200000-0000-4000-8000-000000000001','authenticated','authenticated','arcade-fixture@example.invalid');
select set_config('request.jwt.claim.sub','cc200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"cc200000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
do $$
declare v_pack uuid; v_q uuid; v_attempt uuid; v_state jsonb; v_initial jsonb; v_results jsonb; v_bad uuid:=gen_random_uuid(); v_deadline bigint; v_blocked boolean; i integer;
begin
  perform public.council_enter('Player 🦃✨');
  insert into council_private.packs(title,published,created_by) values('ARCADE ROLLBACK FIXTURE',true,auth.uid()) returning id into v_pack;
  for i in 0..6 loop
    insert into council_private.questions(pack_id,position,prompt) values(v_pack,i,'SYNTHETIC FIXTURE '||i) returning id into v_q;
    perform council_private.add_answer(v_q,'{"canonical":"Apple","tier":"councillion","aliases":[],"explanation":"Fixture gem"}'::jsonb);
    perform council_private.add_answer(v_q,'{"canonical":"Hidden key fixture","tier":"dino","aliases":[]}'::jsonb);
  end loop;
  v_initial:=public.council_begin(v_pack);v_attempt:=(v_initial->>'id')::uuid;v_q:=(v_initial#>>'{question,id}')::uuid;v_deadline:=(v_initial->>'deadline')::bigint;
  v_state:=public.council_answer(v_attempt,v_q,'not an accepted fixture',v_bad);
  perform pg_temp.arcade_assert(v_state->>'status'='active' and (v_state->>'lockedCount')::integer=0,'invalid does not lock or advance');
  perform pg_temp.arcade_assert((v_state->>'deadline')::bigint=v_deadline,'invalid does not reset timer');
  perform pg_temp.arcade_assert(v_state#>>'{feedback,kind}'='invalid','invalid feedback returned');
  perform public.council_answer(v_attempt,v_q,'not an accepted fixture',v_bad);
  perform pg_temp.arcade_assert((select count(*) from council_private.invalid_guesses where attempt_id=v_attempt)=1,'invalid request retry logs once');
  v_blocked:=false;begin perform public.council_answer(v_attempt,v_q,'Apple',v_bad);exception when others then v_blocked:=true;end;
  perform pg_temp.arcade_assert(v_blocked,'invalid request ID cannot be repurposed');
  v_state:=public.council_answer(v_attempt,v_q,'appel',gen_random_uuid());
  perform pg_temp.arcade_assert(v_state#>>'{feedback,kind}'='suggestion' and v_state->>'status'='active','typo requires confirmation');
  v_state:=public.council_confirm_answer(v_attempt,v_q,'appel',gen_random_uuid());
  perform pg_temp.arcade_assert(v_state->>'status'='between' and (v_state->>'runScore')::integer=100,'valid corrected answer locks and scores');
  perform pg_temp.arcade_assert((v_state->>'depth')::integer=1000 and (v_state->>'hasCouncillion')::boolean,'gold depth state');
  perform pg_temp.arcade_assert(v_state#>>'{lastAnswer,canonical}'='Apple' and v_state#>>'{lastAnswer,explanation}'='Fixture gem','own accepted answer reveal');
  perform pg_temp.arcade_assert(position('Hidden key fixture' in v_state::text)=0,'unsubmitted keys remain hidden');
  v_blocked:=false;begin perform public.council_results(v_attempt);exception when insufficient_privilege then v_blocked:=true;end;
  perform pg_temp.arcade_assert(v_blocked,'full results guarded before completion');
  v_state:=public.council_next(v_attempt);
  perform pg_temp.arcade_assert((v_state->>'hasCouncillion')::boolean,'gold persists on next question');
  for i in 1..6 loop
    if i>1 then v_state:=public.council_next(v_attempt);end if;
    if i=1 then
      update council_private.attempts set deadline=clock_timestamp()-interval '1 second' where id=v_attempt;
    end if;
    v_state:=public.council_answer(v_attempt,(v_state#>>'{question,id}')::uuid,'Apple',gen_random_uuid());
  end loop;
  v_results:=public.council_results(v_attempt);
  perform pg_temp.arcade_assert((v_results->>'total')::integer=600,'timeout scores zero and remaining valid guesses score normally');
  v_results:=public.council_leaderboard(v_pack);
  perform pg_temp.arcade_assert(v_results#>>'{0,username}'='Player 🦃✨','emoji username retained');
  perform pg_temp.arcade_assert(v_results#>>'{0,marks,0}'='🟨' and v_results#>>'{0,marks,1}'='⬛' and jsonb_array_length(v_results#>'{0,marks}')=7,'seven score emojis');
  perform pg_temp.arcade_assert(not has_table_privilege('authenticated','council_private.invalid_guesses','SELECT'),'invalid guess history private to backend');
end;
$$;
rollback;
