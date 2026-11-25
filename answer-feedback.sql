-- Run as postgres in a disposable Supabase project after all upgrades. All fixtures roll back.
begin;
create or replace function pg_temp.feedback_assert(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FEEDBACK TEST FAILED: %',msg; end if; end; $$;
insert into auth.users(id,aud,role,email) values('cc300000-0000-4000-8000-000000000001','authenticated','authenticated','feedback-fixture@example.invalid');
select set_config('request.jwt.claim.sub','cc300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"cc300000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
do $$
declare p uuid; q uuid; a uuid; s jsonb; original jsonb; resumed jsonb; i integer;
begin
 perform public.council_enter('Feedback Fixture');
 insert into council_private.packs(title,published,created_by) values('ROLLBACK FEEDBACK FIXTURE',true,auth.uid()) returning id into p;
 for i in 0..6 loop
  insert into council_private.questions(pack_id,position,prompt) values(p,i,'Synthetic feedback fixture '||i) returning id into q;
  perform council_private.add_answer(q,'{"canonical":"Apple","tier":"dino","aliases":["red apple"]}'::jsonb);
 end loop;
 original:=public.council_begin(p);a:=(original->>'id')::uuid;q:=(original#>>'{question,id}')::uuid;
 s:=public.council_answer(a,q,'appel',gen_random_uuid());
 perform pg_temp.feedback_assert(s#>>'{feedback,kind}'='suggestion' and s#>>'{feedback,candidate}'='Apple','unique typo is proposed');
 perform pg_temp.feedback_assert(s->>'deadline'=original->>'deadline' and (s->>'lockedCount')::integer=0,'proposal does not lock or reset clock');
 s:=public.council_answer(a,q,'invalid fixture',gen_random_uuid());
 perform pg_temp.feedback_assert(s#>>'{feedback,message}'='"invalid fixture" is invalid. Try again.','invalid feedback quotes input');
 s:=public.council_confirm_answer(a,q,'appel',gen_random_uuid());
 perform pg_temp.feedback_assert(s->>'status'='between' and s#>>'{lastAnswer,rawAnswer}'='appel','confirmation locks original input');
 s:=public.council_next(a);q:=(s#>>'{question,id}')::uuid;
 s:=public.council_answer(a,q,'',gen_random_uuid());
 perform pg_temp.feedback_assert(s->>'status'='between' and (s#>>'{lastAnswer,points}')::integer=0,'blank explicitly skips');
 s:=public.council_next(a);q:=(s#>>'{question,id}')::uuid;
 resumed:=public.council_resume(a,q);s:=public.council_resume(a,q);
 perform pg_temp.feedback_assert((s->>'lockedCount')::integer=3 and s#>>'{question,id}'=resumed#>>'{question,id}','resume consumes exactly one interrupted question');
 perform pg_temp.feedback_assert(s->>'deadline'=resumed->>'deadline','retrying resume keeps deadline');
 q:=(s#>>'{question,id}')::uuid;perform public.council_answer(a,q,'appel',gen_random_uuid());
 update council_private.attempts set deadline=clock_timestamp()-interval '1 second' where id=a;
 s:=public.council_confirm_answer(a,q,'appel',gen_random_uuid());
 perform pg_temp.feedback_assert((s#>>'{lastAnswer,points}')::integer=0,'late confirmation cannot score');
 perform pg_temp.feedback_assert(not has_function_privilege('anon','public.council_resume(uuid,uuid)','EXECUTE'),'anonymous database role denied resume');
 perform pg_temp.feedback_assert(not has_function_privilege('authenticated','council_private.submit_answer(uuid,uuid,text,uuid,boolean)','EXECUTE'),'private decision helper denied direct access');
end;$$;
rollback;
