-- Arcade gameplay upgrade: apply after all earlier pack/replay/typo upgrades.
-- No trivia or accounts seeded; existing locked results are preserved.
begin;
create table if not exists council_private.invalid_guesses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  pack_id uuid not null,
  question_id uuid not null,
  request_id uuid not null unique,
  raw_answer text not null default '' check(length(raw_answer)<=200),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(attempt_id,pack_id) references council_private.attempts(id,pack_id),
  foreign key(question_id,pack_id) references council_private.questions(id,pack_id)
);
create index if not exists council_invalid_guesses_attempt_question on council_private.invalid_guesses(attempt_id,question_id);
alter table council_private.invalid_guesses enable row level security;
revoke all on council_private.invalid_guesses from public,anon,authenticated;

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
    'isOfficial',v_a.is_official,'status',v_a.status,'position',v_a.position,
    'deadline',case when v_a.deadline is null then null else floor(extract(epoch from v_a.deadline)*1000)::bigint end,
    'serverNow',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'question',case when v_a.status='active' then jsonb_build_object('id',v_q.id,'prompt',v_q.prompt) else null end,
    'lockedCount',jsonb_array_length(v_history),'runScore',v_score,'depth',v_score*10,
    'hasCouncillion',exists(select 1 from council_private.submissions where attempt_id=v_a.id and points=100),
    'history',v_history,'lastAnswer',v_history->(jsonb_array_length(v_history)-1));
end;
$$;

create or replace function council_private.lock_answer(p_attempt_id uuid,p_answer text,p_request_id uuid,p_timeout boolean) returns void
language plpgsql set search_path='' as $$
declare v_a council_private.attempts; v_q uuid; v_match uuid; v_points integer; v_status text; v_raw text:=coalesce(trim(p_answer),'');
begin
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status<>'active' then raise exception 'No active question.'; end if;
  select id into strict v_q from council_private.questions where pack_id=v_a.pack_id and position=v_a.position for share;
  if p_timeout then v_raw:=''; v_status:='timeout'; v_points:=0;
  elsif v_raw='' then raise exception 'An empty answer cannot lock before timeout.';
  else
    v_match:=council_private.match_answer(v_q,v_raw);
    select t.points into v_points from council_private.accepted_answers ca
      join council_private.tiers t on t.id=ca.tier where ca.id=v_match;
    -- Automatic final decision: unknown/ambiguous answers score zero. No review gate.
    if v_match is null then raise exception 'Unrecognized answers must be retried before timeout.'; else v_status:='accepted'; end if;
  end if;
  insert into council_private.submissions(attempt_id,pack_id,question_id,request_id,raw_answer,canonical_id,review_status,points)
    values(v_a.id,v_a.pack_id,v_q,p_request_id,v_raw,v_match,v_status,v_points);
  update council_private.attempts set
    status=case when v_a.position=6 then 'completed' else 'between' end,
    position=least(v_a.position+1,6),deadline=null,
    completed_at=case when v_a.position=6 then clock_timestamp() else null end
    where id=v_a.id;
end;
$$;

create or replace function public.council_enter(p_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user(); v_username text:=trim(p_username); v_old text;
begin
  if v_username is null or length(v_username) not between 2 and 24 or v_username ~ '[[:cntrl:]<>&"''/\\]' or v_username ~ U&'[\200B\200E\200F\202A-\202E\2066-\2069]' or not(v_username ~ '[[:alnum:]]' or v_username ~ U&'[\2600-\27BF\+01F000-\+01FAFF]') then
    raise exception 'Choose a username with 2–24 visible characters.';
  end if;
  -- Serialize name changes with begin(), so a name cannot change after play starts.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));
  select username into v_old from council_private.players where id=v_uid for update;
  if v_old is not null and exists(select 1 from council_private.attempts where player_id=v_uid) and v_old<>v_username then
    raise exception 'Your username is locked after you start playing.';
  end if;
  begin
    insert into council_private.players(id,username) values(v_uid,v_username)
    on conflict(id) do update set username=excluded.username;
  exception when unique_violation then raise exception 'That username is already taken. Choose another.';
  end;
  return public.council_profile();
end;
$$;

create or replace function public.council_answer(p_attempt_id uuid,p_question_id uuid,p_answer text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
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
  if clock_timestamp()>=v_a.deadline then
    perform council_private.lock_answer(p_attempt_id,'',p_request_id,true);
    return council_private.state_json(p_attempt_id);
  end if;
  select * into v_invalid from council_private.invalid_guesses where request_id=p_request_id;
  if found then
    if v_invalid.attempt_id<>p_attempt_id or v_invalid.question_id<>p_question_id or v_invalid.raw_answer<>v_raw then raise exception 'Use a fresh request ID for another guess.'; end if;
    return council_private.state_json(p_attempt_id)||jsonb_build_object('feedback',jsonb_build_object('kind','invalid','message','Not recognized. Try again.'));
  end if;
  v_match:=council_private.match_answer(v_q,v_raw);
  if v_match is null then
    -- Keep exactly the original deadline and question. Bound stored guesses to
    -- 100 per question; additional invalid guesses still get rejection feedback.
    if (select count(*) from council_private.invalid_guesses where attempt_id=p_attempt_id and question_id=v_q)<100 then
      insert into council_private.invalid_guesses(attempt_id,pack_id,question_id,request_id,raw_answer) values(p_attempt_id,v_a.pack_id,v_q,p_request_id,v_raw);
    end if;
    return council_private.state_json(p_attempt_id)||jsonb_build_object('feedback',jsonb_build_object('kind','invalid','message','Not recognized. Try again.'));
  end if;
  perform council_private.lock_answer(p_attempt_id,v_raw,p_request_id,false);
  return council_private.state_json(p_attempt_id);
end;
$$;

create or replace function council_private.attempt_marks(p_attempt_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('marks',coalesce(jsonb_agg(case s.points when 100 then '🟨' when 85 then '🟪' when 60 then '🟧' when 30 then '🟦' when 15 then '🟩' when 10 then '⬜' else '⬛' end order by q.position),'[]'::jsonb),
    'markTiers',coalesce(jsonb_agg(t.id order by q.position),'[]'::jsonb))
  from council_private.submissions s join council_private.questions q on q.id=s.question_id
    left join council_private.tiers t on t.points=s.points where s.attempt_id=p_attempt_id;
$$;

create or replace function public.council_leaderboard(p_pack_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform council_private.require_user();
  return coalesce((with per_attempt as(
    select a.id,a.player_id,sum(s.points)::bigint score,count(*) filter(where s.points=100) ones,
      count(*) filter(where s.review_status='pending') pending
    from council_private.attempts a join council_private.submissions s on s.attempt_id=a.id
    where a.status='completed' and a.is_official and (p_pack_id is null or a.pack_id=p_pack_id)
    group by a.id,a.player_id
  ), totals as(
    select p.id,p.username,sum(a.score)::bigint score,count(*) games,sum(a.ones)::bigint ones,sum(a.pending)::bigint pending
    from per_attempt a join council_private.players p on p.id=a.player_id group by p.id,p.username
  ), ranked as(select *,rank() over(order by score desc) place from totals)
  select jsonb_agg(jsonb_build_object('rank',place,'username',username,'score',score,'games',games,'ones',ones,'pending',pending)||council_private.attempt_marks((select a.id from council_private.attempts a where a.player_id=ranked.id and a.is_official and a.status='completed' and (p_pack_id is null or a.pack_id=p_pack_id) order by a.completed_at desc,a.id desc limit 1))
    order by score desc,lower(username),id) from ranked),'[]'::jsonb);
end;
$$;

create or replace function public.council_reviews() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform council_private.require_admin();
  return coalesce((select jsonb_agg(j order by created_at desc,id) from(
    select s.id::text id,s.created_at,jsonb_build_object('id',s.id,'type','submission','submissionId',s.id,'actionable',true,
      'attemptId',s.attempt_id,'isOfficial',atp.is_official,'questionId',s.question_id,'prompt',q.prompt,'packTitle',pk.title,
      'rawAnswer',s.raw_answer,'username',p.username,'reviewStatus',s.review_status,'canonical',ca.canonical,'points',s.points,
      'answers',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'canonical',a.canonical,'tier',a.tier,'points',t.points) order by t.points desc,lower(a.canonical),a.id)
        from council_private.accepted_answers a join council_private.tiers t on t.id=a.tier where a.question_id=s.question_id),'[]'::jsonb)
    ) j from council_private.submissions s join council_private.attempts atp on atp.id=s.attempt_id
    join council_private.players p on p.id=atp.player_id join council_private.questions q on q.id=s.question_id
    join council_private.packs pk on pk.id=atp.pack_id left join council_private.accepted_answers ca on ca.id=s.canonical_id
    union all
    select 'invalid:'||ig.id::text,ig.created_at,jsonb_build_object('id','invalid:'||ig.id::text,'type','invalid_attempt','submissionId',null,'actionable',false,
      'attemptId',ig.attempt_id,'isOfficial',atp.is_official,'questionId',ig.question_id,'prompt',q.prompt,'packTitle',pk.title,
      'rawAnswer',ig.raw_answer,'username',p.username,'reviewStatus','invalid_attempt','canonical',null,'points',0,'answers','[]'::jsonb)
    from council_private.invalid_guesses ig join council_private.attempts atp on atp.id=ig.attempt_id
      join council_private.players p on p.id=atp.player_id join council_private.questions q on q.id=ig.question_id
      join council_private.packs pk on pk.id=atp.pack_id
    order by created_at desc,id limit 2000
  ) r),'[]'::jsonb);
end;
$$;
revoke all on function council_private.attempt_marks(uuid) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
