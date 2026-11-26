-- Run ONCE in Supabase SQL Editor before uploading the new website.
-- Preserves all packs, players, answers and first-run slots. Safe to rerun.
begin;
-- Removed scores retain their official slot, preventing a fresh leaderboard attempt.
alter table council_private.attempts add column if not exists voided_at timestamptz;
alter table council_private.attempts add column if not exists voided_by uuid references auth.users(id);
alter table council_private.attempts add column if not exists void_reason text not null default '';
-- The author already knows the answers; existing author runs become practice too.
update council_private.attempts a set is_official=false
where exists(select 1 from council_private.admin_members gm where gm.user_id=a.player_id);


create or replace function public.council_packs(p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user();
begin
  if p_admin then perform council_private.require_admin(); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'title',p.title,'description',p.description,'icon',p.icon,'color',p.color,'published',p.published,
    'completedCount',(select count(*) from council_private.attempts a where a.pack_id=p.id and a.status='completed' and a.is_official and a.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=a.player_id)),
    'myAttempt',(select jsonb_build_object('id',a.id,'status',a.status) from council_private.attempts a where a.pack_id=p.id and a.player_id=v_uid and a.is_official),
    'myPractice',(select jsonb_build_object('id',a.id,'status',a.status) from council_private.attempts a where a.pack_id=p.id and a.player_id=v_uid and not a.is_official and a.status<>'completed' order by a.created_at desc,a.id desc limit 1)
  ) order by p.created_at,p.id) from council_private.packs p where p.deleted_at is null and (p.published or p_admin)),'[]'::jsonb);
end;
$$;

create or replace function council_private.state_json(p_attempt_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare v_a council_private.attempts; v_q council_private.questions; v_history jsonb; v_score integer;
begin
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status='active' then select * into strict v_q from council_private.questions where pack_id=v_a.pack_id and position=v_a.position; end if;
  select coalesce(jsonb_agg(jsonb_build_object('questionId',q.id,'prompt',q.prompt,'rawAnswer',s.raw_answer,
    'canonical',ca.canonical,'points',s.points,'tier',t.id,'reviewStatus',s.review_status,
    'explanation',case when s.points=100 then coalesce(nullif(ca.explanation,''),nullif(s.review_note,''),'Awarded by the Game Master.') else '' end
  ) order by q.position),'[]'::jsonb),coalesce(sum(s.points),0)::integer into v_history,v_score
    from council_private.submissions s join council_private.questions q on q.id=s.question_id
    left join council_private.accepted_answers ca on ca.id=s.canonical_id
    left join council_private.tiers t on t.points=s.points where s.attempt_id=v_a.id;
  return jsonb_build_object('id',v_a.id,'packId',v_a.pack_id,'title',(select title from council_private.packs where id=v_a.pack_id),
    'isOfficial',v_a.is_official and v_a.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=v_a.player_id),
    'scoreStatus',case when v_a.voided_at is not null then 'removed' when not v_a.is_official or exists(select 1 from council_private.admin_members gm where gm.user_id=v_a.player_id) then 'practice' else 'official' end,
    'isGameMaster',exists(select 1 from council_private.admin_members gm where gm.user_id=v_a.player_id),'status',v_a.status,'position',v_a.position,
    'deadline',case when v_a.deadline is null then null else floor(extract(epoch from v_a.deadline)*1000)::bigint end,
    'serverNow',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'question',case when v_a.status='active' then jsonb_build_object('id',v_q.id,'prompt',v_q.prompt) else null end,
    'lockedCount',jsonb_array_length(v_history),'runScore',v_score,'depth',v_score*10,
    'hasCouncillion',exists(select 1 from council_private.submissions where attempt_id=v_a.id and points=100),
    'history',v_history,'lastAnswer',v_history->(jsonb_array_length(v_history)-1));
end;
$$;

create or replace function public.council_begin(p_pack_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user(); v_host boolean:=council_private.is_admin(); v_a uuid; v_pack council_private.packs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));
  if v_host then
    insert into council_private.players(id,username) values(v_uid,'Game Master '||left(v_uid::text,8)) on conflict(id) do nothing;
  elsif not exists(select 1 from council_private.players where id=v_uid) then raise exception 'Choose your username first.'; end if;
  -- Pack row lock serializes author edits/publication with first attempt creation.
  select * into v_pack from council_private.packs where id=p_pack_id for update;
  if not found then raise exception 'Pack not found.'; end if;
  perform council_private.require_open_pack(p_pack_id);
  if v_host then
    select id into v_a from council_private.attempts where player_id=v_uid and pack_id=p_pack_id and not is_official and status<>'completed' order by created_at desc,id desc limit 1 for update;
  else
    select id into v_a from council_private.attempts where player_id=v_uid and pack_id=p_pack_id and is_official for update;
  end if;
  if v_a is null then
    if not v_pack.published then raise exception 'This pack is not open for play.'; end if;
    if (select count(*) from council_private.questions where pack_id=p_pack_id)<>7 then raise exception 'This pack is incomplete.'; end if;
    insert into council_private.attempts(player_id,pack_id,is_official,status,position,deadline)
      values(v_uid,p_pack_id,not v_host,'active',0,clock_timestamp()+interval '25 seconds') returning id into v_a;
  end if;
  perform council_private.expire_attempt(v_a);
  return council_private.state_json(v_a);
end;
$$;

create or replace function public.council_practice(p_pack_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user(); v_a council_private.attempts;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));
  perform 1 from council_private.packs where id=p_pack_id and published and deleted_at is null for share;
  if not found then raise exception 'This pack is not open for replays.'; end if;
  if not council_private.is_admin() and not exists(select 1 from council_private.attempts where player_id=v_uid and pack_id=p_pack_id and is_official and status='completed') then
    raise exception 'Finish your first leaderboard run before replaying.' using errcode='42501';
  end if;
  if p_request_id is null then raise exception 'A replay request ID is required.'; end if;
  select * into v_a from council_private.attempts where id=p_request_id for update;
  if found then
    if v_a.player_id<>v_uid or v_a.pack_id<>p_pack_id or v_a.is_official then
      raise exception 'Replay request ID already used.' using errcode='42501';
    end if;
  else
    insert into council_private.attempts(id,player_id,pack_id,is_official,status,position,deadline)
      values(p_request_id,v_uid,p_pack_id,false,'active',0,clock_timestamp()+interval '25 seconds');
  end if;
  perform council_private.expire_attempt(p_request_id);
  return council_private.state_json(p_request_id);
end;
$$;

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
  ) then
    return council_private.state_json(p_attempt_id)||jsonb_build_object('feedback',jsonb_build_object('kind','suggestion','candidate',(select canonical from council_private.accepted_answers where id=v_match),'rawAnswer',v_raw,'message','Did you mean “'||(select canonical from council_private.accepted_answers where id=v_match)||'”?'));
  end if;
  perform council_private.lock_answer(p_attempt_id,v_raw,p_request_id,false);
  return council_private.state_json(p_attempt_id);
end;
$$;

create or replace function public.council_results(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_a council_private.attempts; v_denominator bigint; v_questions jsonb;
begin
  perform council_private.owned_attempt(p_attempt_id);
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status<>'completed' then raise exception 'Finish all seven questions before viewing results.' using errcode='42501'; end if;
  select count(*) into v_denominator from council_private.attempts where pack_id=v_a.pack_id and status='completed' and is_official and voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=player_id);
  select jsonb_agg(jsonb_build_object(
    'id',q.id,'prompt',q.prompt,'rawAnswer',s.raw_answer,'canonical',ca.canonical,
    'points',s.points,'tier',awarded.id,'reviewStatus',s.review_status,
    'explanation',case when s.points=100 then coalesce(nullif(ca.explanation,''),nullif(s.review_note,''),'Awarded by the Game Master.') else '' end,
    'popularity',jsonb_build_object('count',coalesce(pop.n,0),'total',v_denominator,
      'percentage',case when v_denominator=0 then 0 else round(coalesce(pop.n,0)*100.0/v_denominator,2) end),
    'answers',coalesce((select jsonb_agg(jsonb_build_object('id',ans.id,'canonical',ans.canonical,'tier',ans.tier,
      'points',t.points,'explanation',ans.explanation,'count',coalesce(ap.n,0),
      'percentage',case when v_denominator=0 then 0 else round(coalesce(ap.n,0)*100.0/v_denominator,2) end
    ) order by t.points desc,lower(ans.canonical),ans.id)
      from council_private.accepted_answers ans join council_private.tiers t on t.id=ans.tier
      left join lateral(select count(*) n from council_private.submissions ps
        join council_private.attempts pa on pa.id=ps.attempt_id
        where ps.question_id=q.id and ps.canonical_id=ans.id and ps.review_status='accepted' and pa.status='completed' and pa.is_official and pa.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=pa.player_id)) ap on true
      where ans.question_id=q.id),'[]'::jsonb)
  ) order by q.position) into v_questions
  from council_private.questions q join council_private.submissions s on s.question_id=q.id and s.attempt_id=v_a.id
    left join council_private.accepted_answers ca on ca.id=s.canonical_id
    left join council_private.tiers awarded on awarded.points=s.points
    left join lateral(select count(*) n from council_private.submissions ps
      join council_private.attempts pa on pa.id=ps.attempt_id
      where ps.question_id=q.id and ps.canonical_id=s.canonical_id and ps.review_status='accepted' and pa.status='completed' and pa.is_official and pa.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=pa.player_id)) pop on true
    where q.pack_id=v_a.pack_id;
  return jsonb_build_object('attemptId',v_a.id,'packId',v_a.pack_id,
    'isOfficial',v_a.is_official and v_a.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=v_a.player_id),
    'scoreStatus',case when v_a.voided_at is not null then 'removed' when not v_a.is_official or exists(select 1 from council_private.admin_members gm where gm.user_id=v_a.player_id) then 'practice' else 'official' end,
    'isGameMaster',exists(select 1 from council_private.admin_members gm where gm.user_id=v_a.player_id),
    'officialAttemptId',(select id from council_private.attempts where player_id=v_a.player_id and pack_id=v_a.pack_id and is_official),
    'officialScore',(select coalesce(sum(s.points),0) from council_private.attempts a join council_private.submissions s on s.attempt_id=a.id where a.player_id=v_a.player_id and a.pack_id=v_a.pack_id and a.is_official and a.status='completed' and a.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=a.player_id)),
    'title',(select title from council_private.packs where id=v_a.pack_id),
    'username',(select username from council_private.players where id=v_a.player_id),
    'total',(select coalesce(sum(points),0) from council_private.submissions where attempt_id=v_a.id),
    'max',700,'ones',(select count(*) from council_private.submissions where attempt_id=v_a.id and points=100),
    'pendingCount',(select count(*) from council_private.submissions where attempt_id=v_a.id and review_status='pending'),
    'questions',coalesce(v_questions,'[]'::jsonb));
end;
$$;

create or replace function public.council_leaderboard(p_pack_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform council_private.require_user();
  return coalesce((with per_attempt as(
    select a.id,a.player_id,sum(s.points)::bigint score,count(*) filter(where s.points=100) ones,
      count(*) filter(where s.review_status='pending') pending
    from council_private.attempts a join council_private.submissions s on s.attempt_id=a.id
    where a.status='completed' and a.is_official and a.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=a.player_id) and (p_pack_id is null or a.pack_id=p_pack_id)
    group by a.id,a.player_id
  ), totals as(
    select p.id,p.username,sum(a.score)::bigint score,count(*) games,sum(a.ones)::bigint ones,sum(a.pending)::bigint pending
    from per_attempt a join council_private.players p on p.id=a.player_id group by p.id,p.username
  ), ranked as(select *,rank() over(order by score desc) place from totals)
  select jsonb_agg(jsonb_build_object('rank',place,'username',username,'score',score,'games',games,'ones',ones,'pending',pending)||council_private.attempt_marks((select a.id from council_private.attempts a where a.player_id=ranked.id and a.is_official and a.status='completed' and a.voided_at is null and not exists(select 1 from council_private.admin_members gm where gm.user_id=a.player_id) and (p_pack_id is null or a.pack_id=p_pack_id) order by a.completed_at desc,a.id desc limit 1))
    order by score desc,lower(username),id) from ranked),'[]'::jsonb);
end;
$$;

-- Author-only score moderation. Preserve answers and the first-run slot for audit.
create or replace function public.council_admin_scores() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform council_private.require_admin();
  return coalesce((select jsonb_agg(j order by completed_at desc,id) from (
    select a.id,a.completed_at,jsonb_build_object('attemptId',a.id,'packId',a.pack_id,'packTitle',pk.title,
      'username',p.username,'score',(select coalesce(sum(points),0) from council_private.submissions where attempt_id=a.id),
      'isOfficial',a.is_official and not exists(select 1 from council_private.admin_members gm where gm.user_id=a.player_id),
      'removed',a.voided_at is not null,'reason',a.void_reason,'completedAt',floor(extract(epoch from a.completed_at)*1000)::bigint) j
    from council_private.attempts a join council_private.players p on p.id=a.player_id join council_private.packs pk on pk.id=a.pack_id
    where a.status='completed'
  ) all_scores),'[]'::jsonb);
end;
$$;
create or replace function public.council_admin_delete_score(p_attempt_id uuid,p_reason text default 'Removed by Game Master') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_admin(); v_a council_private.attempts;
begin
  select * into v_a from council_private.attempts where id=p_attempt_id for update;
  if not found or v_a.status<>'completed' then raise exception 'Completed score not found.'; end if;
  if v_a.voided_at is null then
    update council_private.attempts set voided_at=clock_timestamp(),voided_by=v_uid,void_reason=left(coalesce(p_reason,'Removed by Game Master'),500) where id=v_a.id;
    insert into council_private.audit_log(actor_id,action,target_id,before_value,after_value)
      values(v_uid,'score_removed',v_a.id,to_jsonb(v_a),jsonb_build_object('reason',left(coalesce(p_reason,''),500)));
  end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke execute on function public.council_admin_scores() from public,anon;
revoke execute on function public.council_admin_delete_score(uuid,text) from public,anon;
grant execute on function public.council_admin_scores() to authenticated;
grant execute on function public.council_admin_delete_score(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
