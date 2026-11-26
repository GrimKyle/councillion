-- Run as postgres in a DISPOSABLE Supabase project after the new migration.
-- Fixtures roll back; this file is not run by npm test.
begin;
create or replace function pg_temp.launch_assert(ok boolean,message text) returns void
language plpgsql as $$begin if ok is distinct from true then raise exception 'LAUNCH CHECK: %',message;end if;end;$$;
insert into auth.users(id,aud,role,email) values
 ('cc250000-0000-4000-8000-000000000001','authenticated','authenticated','launch-player@example.invalid'),
 ('cc250000-0000-4000-8000-000000000002','authenticated','authenticated','launch-admin@example.invalid');
insert into council_private.admin_members(user_id) values('cc250000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','cc250000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"cc250000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
do $$
declare p uuid;q uuid;a uuid;s jsonb;deadline text;blocked boolean:=false;i integer;host_attempt uuid;
begin
 perform public.council_enter('Launch fixture player');
 insert into council_private.packs(title,published,created_by) values('ROLLBACK LAUNCH FIXTURE',true,auth.uid()) returning id into p;
 for i in 0..6 loop
  insert into council_private.questions(pack_id,position,prompt) values(p,i,'Launch fixture '||i) returning id into q;
  perform council_private.add_answer(q,'{"canonical":"Apple","tier":"dino","aliases":["red apple"]}'::jsonb);
 end loop;
 s:=public.council_begin(p);a:=(s->>'id')::uuid;q:=(s#>>'{question,id}')::uuid;deadline:=s->>'deadline';
 s:=public.council_answer(a,q,'red apple',gen_random_uuid());
 perform pg_temp.launch_assert(s#>>'{feedback,kind}'='suggestion' and s->>'deadline'=deadline and (s->>'lockedCount')::int=0,'alias confirmation preserves question/deadline');
 s:=public.council_confirm_answer(a,q,'red apple',gen_random_uuid());
 for i in 1..6 loop
  s:=public.council_next(a);s:=public.council_answer(a,(s#>>'{question,id}')::uuid,'Apple',gen_random_uuid());
 end loop;
 perform pg_temp.launch_assert(jsonb_array_length(public.council_leaderboard(p))=1,'player enters the board');
 begin perform public.council_admin_delete_score(a,'No permission');exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.launch_assert(blocked,'ordinary players cannot delete scores');
 perform pg_temp.launch_assert(not has_function_privilege('anon','public.council_admin_delete_score(uuid,text)','execute'),'anonymous role has no moderation grant');
 perform set_config('request.jwt.claim.sub','cc250000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"sub":"cc250000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
 perform public.council_admin_delete_score(a,'Fixture cheating');
 perform public.council_admin_delete_score(a,'Idempotent retry');
 perform pg_temp.launch_assert(jsonb_array_length(public.council_leaderboard(p))=0,'removed score leaves pack board');
 perform pg_temp.launch_assert((select count(*) from council_private.submissions where attempt_id=a)=7,'removal preserves answers');
 perform pg_temp.launch_assert((select is_official and voided_at is not null from council_private.attempts where id=a),'official slot is retained');
 s:=public.council_begin(p);host_attempt:=(s->>'id')::uuid;
 perform pg_temp.launch_assert(not (s->>'isOfficial')::boolean and (s->>'isGameMaster')::boolean,'author begins practice automatically');
 for i in 0..6 loop
  if i>0 then s:=public.council_next(host_attempt);end if;
  s:=public.council_answer(host_attempt,(s#>>'{question,id}')::uuid,'Apple',gen_random_uuid());
 end loop;
 perform pg_temp.launch_assert(jsonb_array_length(public.council_leaderboard())=0,'author practice never enters the overall board');
 s:=public.council_results(host_attempt);
 perform pg_temp.launch_assert((s#>>'{questions,0,popularity,total}')::int=0,'removed scores and author practice do not affect answer percentages');
 perform set_config('request.jwt.claim.sub','cc250000-0000-4000-8000-000000000001',true);
 s:=public.council_begin(p);
 perform pg_temp.launch_assert((s->>'id')::uuid=a and s->>'scoreStatus'='removed','removed player cannot get another official attempt');
end;
$$;
rollback;
