-- Run after upgrade-arcade-gameplay.sql. Existing data is preserved.
begin;
create or replace function council_private.submit_answer(p_attempt_id uuid,p_question_id uuid,p_answer text,p_request_id uuid,p_confirm boolean) returns jsonb
language plpgsql set search_path='' as $$
declare v_a council_private.attempts; v_existing council_private.submissions; v_invalid council_private.invalid_guesses;
  v_q uuid; v_raw text:=coalesce(trim(p_answer),''); v_match uuid;
begin
  perform council_private.owned_attempt(p_attempt_id);
  if p_request_id is null then raise exception 'A request ID is required.'; end if;
  if length(v_raw)>200 then raise exception 'Answers must be 200 characters or fewer.'; end if;
  select * into v_existing from council_private.submissions where request_id=p_request_id;
  if found then
    if v_existing.attempt_id<>p_attempt_id or v_existing.question_id<>p_question_id then raise exception 'Request ID already used.'; end if;
    return council_private.state_json(p_attempt_id);
  end if;
  if exists(select 1 from council_private.submissions where attempt_id=p_attempt_id and question_id=p_question_id) then return council_private.state_json(p_attempt_id); end if;
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status<>'active' then raise exception 'Start the next question before answering.'; end if;
  select id into strict v_q from council_private.questions where pack_id=v_a.pack_id and position=v_a.position for share;
  if v_q<>p_question_id then raise exception 'This is not your active question.'; end if;
  if clock_timestamp()>=v_a.deadline or v_raw='' then
    perform council_private.lock_answer(p_attempt_id,'',p_request_id,true);
    return council_private.state_json(p_attempt_id);
  end if;
  select * into v_invalid from council_private.invalid_guesses where request_id=p_request_id;
  if found then
    if v_invalid.attempt_id<>p_attempt_id or v_invalid.question_id<>p_question_id or v_invalid.raw_answer<>v_raw then raise exception 'Use a fresh request ID for another guess.'; end if;
    return council_private.state_json(p_attempt_id)||jsonb_build_object('feedback',jsonb_build_object('kind','invalid','message','"'||v_raw||'" is invalid. Try again.'));
  end if;
  v_match:=council_private.match_answer(v_q,v_raw);
  if v_match is null then
    -- Keep exactly the original deadline and question. Bound stored guesses to
    -- 100 per question; additional invalid guesses still get rejection feedback.
    if (select count(*) from council_private.invalid_guesses where attempt_id=p_attempt_id and question_id=v_q)<100 then
      insert into council_private.invalid_guesses(attempt_id,pack_id,question_id,request_id,raw_answer) values(p_attempt_id,v_a.pack_id,v_q,p_request_id,v_raw);
    end if;
    return council_private.state_json(p_attempt_id)||jsonb_build_object('feedback',jsonb_build_object('kind','invalid','message','"'||v_raw||'" is invalid. Try again.'));
  end if;
  if not p_confirm and not exists(
    select 1 from council_private.accepted_answers where id=v_match and council_private.normalize_answer(canonical)=council_private.normalize_answer(v_raw)
    union all select 1 from council_private.aliases where answer_id=v_match and normalized=council_private.normalize_answer(v_raw)
  ) then
    return council_private.state_json(p_attempt_id)||jsonb_build_object('feedback',jsonb_build_object('kind','suggestion','candidate',(select canonical from council_private.accepted_answers where id=v_match),'rawAnswer',v_raw,'message','Did you mean “'||(select canonical from council_private.accepted_answers where id=v_match)||'”?'));
  end if;
  perform council_private.lock_answer(p_attempt_id,v_raw,p_request_id,false);
  return council_private.state_json(p_attempt_id);
end;
$$;

create or replace function public.council_answer(p_attempt_id uuid,p_question_id uuid,p_answer text,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select council_private.submit_answer(p_attempt_id,p_question_id,p_answer,p_request_id,false);
$$;
create or replace function public.council_confirm_answer(p_attempt_id uuid,p_question_id uuid,p_answer text,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select council_private.submit_answer(p_attempt_id,p_question_id,p_answer,p_request_id,true);
$$;
create or replace function public.council_resume(p_attempt_id uuid,p_question_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_a council_private.attempts; v_q uuid;
begin
  perform council_private.owned_attempt(p_attempt_id);
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status='active' then
    select id into strict v_q from council_private.questions where pack_id=v_a.pack_id and position=v_a.position;
    if v_q is distinct from p_question_id then return council_private.state_json(p_attempt_id); end if;
    perform council_private.lock_answer(p_attempt_id,'',gen_random_uuid(),true);
  end if;
  update council_private.attempts set status='active',deadline=clock_timestamp()+interval '25 seconds'
    where id=p_attempt_id and status='between';
  return council_private.state_json(p_attempt_id);
end;
$$;

revoke all on function council_private.submit_answer(uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.council_answer(uuid,uuid,text,uuid) from public,anon;
revoke execute on function public.council_confirm_answer(uuid,uuid,text,uuid) from public,anon;
revoke execute on function public.council_resume(uuid,uuid) from public,anon;
grant execute on function public.council_answer(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.council_confirm_answer(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.council_resume(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
