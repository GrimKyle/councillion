-- Run as postgres in a disposable Supabase project AFTER supabase.sql (or upgrade).
-- Exercises real database matching and its scoring integration. Fixtures roll back.
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

create or replace function pg_temp.typo_assert(p_ok boolean,p_message text) returns void
language plpgsql as $$begin
  if p_ok is distinct from true then raise exception 'TYPO TEST FAILED: %',p_message; end if;
end;$$;

insert into auth.users(id,aud,role,email) values
 ('cc100000-0000-4000-8000-000000000001','authenticated','authenticated','typo-fixture@example.invalid');
insert into council_private.players(id,username) values
 ('cc100000-0000-4000-8000-000000000001','Typo Fixture');
select set_config('request.jwt.claim.sub','cc100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"cc100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);

do $$
declare v_pack uuid; v_q uuid; v_answer uuid; v_apple uuid; v_state jsonb; v_attempt uuid;
  v_result jsonb; v_blocked boolean:=false; i integer; v_raw text;
begin
  perform pg_temp.typo_assert(council_private.typo_distance('appel','apple')=1,'adjacent transposition');
  perform pg_temp.typo_assert(council_private.typo_distance('appl','apple')=1,'missing letter');
  perform pg_temp.typo_assert(council_private.typo_distance('appple','apple')=1,'extra letter');
  perform pg_temp.typo_assert(council_private.typo_distance('applw','apple')=1,'substitution');
  perform pg_temp.typo_assert(council_private.typo_distance('aplep','apple')=2,'two edits refused');
  insert into council_private.packs(title,published,created_by) values
    ('ROLLBACK TYPO FIXTURE',true,'cc100000-0000-4000-8000-000000000001') returning id into v_pack;
  for i in 0..6 loop
    insert into council_private.questions(pack_id,position,prompt) values(v_pack,i,'TEST FIXTURE ONLY '||i) returning id into v_q;
    v_answer:=council_private.add_answer(v_q,jsonb_build_object('canonical','Apple','tier','dino','aliases',
      case when i=0 then '["red apple"]'::jsonb else '[]'::jsonb end));
    if i=0 then
      v_apple:=v_answer;
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'appel')=v_apple,'unique swap corrects to canonical');
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'red appel')=v_apple,'configured equivalent alias tolerates typo');
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'apple pie') is null,'unknown phrase not inferred');
    elsif i=1 then
      perform council_private.add_answer(v_q,'{"canonical":"Maple","tier":"kalen","aliases":[]}'::jsonb);
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'aple') is null,'two canonical candidates refused');
    elsif i=2 then
      perform council_private.add_answer(v_q,'{"canonical":"Peach","tier":"kalen","aliases":[]}'::jsonb);
      perform council_private.add_answer(v_q,'{"canonical":"Pear","tier":"kalen","aliases":[]}'::jsonb);
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'peac') is null,'short competitor vetoes ambiguity');
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'peqr') is null,'short accepted spelling not autocorrected');
    elsif i=3 then
      v_answer:=council_private.add_answer(v_q,'{"canonical":"Apply","tier":"grimkyle","aliases":[]}'::jsonb);
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'apply')=v_answer,'exact answer beats nearby spelling');
    elsif i=4 then
      perform pg_temp.typo_assert(council_private.match_answer(v_q,'red apple') is null,'equivalent phrase needs explicit alias');
    elsif i=5 then
      perform council_private.add_answer(v_q,'{"canonical":"Berry","tier":"kalen","aliases":[]}'::jsonb);
      perform council_private.add_answer(v_q,'{"canonical":"Ferry","tier":"kalen","aliases":[]}'::jsonb);
    end if;
  end loop;
  v_state:=public.council_begin(v_pack); v_attempt:=(v_state->>'id')::uuid;
  for i in 0..6 loop
    if i>0 then v_state:=public.council_next(v_attempt); end if;
    v_raw:=case i when 0 then 'appel' when 1 then 'aple' when 2 then 'peac'
      when 3 then 'apply' when 4 then 'red apple' when 5 then 'herry' else 'appl' end;
    v_state:=pg_temp.expire_invalid(public.council_confirm_answer(v_attempt,(v_state#>>'{question,id}')::uuid,v_raw,gen_random_uuid()));
    perform pg_temp.typo_assert(not(v_state?'points') and not(v_state?'canonical'),'no answer bank disclosed during play');
    if i=0 then
      begin perform public.council_results(v_attempt); exception when insufficient_privilege then v_blocked:=true; end;
      perform pg_temp.typo_assert(v_blocked,'typo result hidden until seven answers');
    end if;
  end loop;
  v_result:=public.council_results(v_attempt);
  perform pg_temp.typo_assert((v_result->>'total')::integer=105,'canonical fixed points awarded');
  perform pg_temp.typo_assert((v_result->>'pendingCount')::integer=0,'no answer requires manual approval');
  perform pg_temp.typo_assert(v_result#>>'{questions,1,reviewStatus}'='timeout','ambiguous answer automatically receives zero');
  perform pg_temp.typo_assert(v_result#>>'{questions,0,rawAnswer}'='appel','raw answer retained');
  perform pg_temp.typo_assert(v_result#>>'{questions,0,canonical}'='Apple','canonical answer recognized');
  perform pg_temp.typo_assert((v_result#>>'{questions,0,popularity,count}')::integer=1,'canonical popularity groups corrected answer');
  raise notice 'Typo matching SQL tests passed; fixtures will roll back.';
end;
$$;
rollback;
