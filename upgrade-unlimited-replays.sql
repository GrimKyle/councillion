-- Councillion unlimited replay upgrade. Run AFTER your original supabase.sql.
-- If needed install upgrade-typo-matching.sql first. Fresh projects only need
-- the latest full supabase.sql. Existing attempts stay official; no data deleted.
begin;

-- Existing first attempts remain official. Unlimited replay rows cannot enter
-- the unique first-attempt slot or be promoted by a client.
alter table council_private.attempts add column if not exists is_official boolean not null default true;
alter table council_private.attempts drop constraint if exists attempts_player_id_pack_id_key;
create unique index if not exists council_one_official_attempt
  on council_private.attempts(player_id,pack_id) where is_official;
create or replace function public.council_packs(p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user();
begin
  if p_admin then perform council_private.require_admin(); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'title',p.title,'description',p.description,'icon',p.icon,'color',p.color,'published',p.published,
    'completedCount',(select count(*) from council_private.attempts a where a.pack_id=p.id and a.status='completed' and a.is_official),
    'myAttempt',(select jsonb_build_object('id',a.id,'status',a.status) from council_private.attempts a where a.pack_id=p.id and a.player_id=v_uid and a.is_official),
    'myPractice',(select jsonb_build_object('id',a.id,'status',a.status) from council_private.attempts a where a.pack_id=p.id and a.player_id=v_uid and not a.is_official and a.status<>'completed' order by a.created_at desc,a.id desc limit 1)
  ) order by p.created_at,p.id) from council_private.packs p where p.published or p_admin),'[]'::jsonb);
end;
$$;

create or replace function council_private.state_json(p_attempt_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare v_a council_private.attempts; v_q council_private.questions;
begin
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status='active' then select * into strict v_q from council_private.questions where pack_id=v_a.pack_id and position=v_a.position; end if;
  return jsonb_build_object('id',v_a.id,'packId',v_a.pack_id,
    'title',(select title from council_private.packs where id=v_a.pack_id),
    'isOfficial',v_a.is_official,'status',v_a.status,'position',v_a.position,
    'deadline',case when v_a.deadline is null then null else floor(extract(epoch from v_a.deadline)*1000)::bigint end,
    'serverNow',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'question',case when v_a.status='active' then jsonb_build_object('id',v_q.id,'prompt',v_q.prompt) else null end,
    'lockedCount',(select count(*) from council_private.submissions where attempt_id=v_a.id));
end;
$$;

create or replace function public.council_begin(p_pack_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user(); v_a uuid; v_pack council_private.packs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));
  if not exists(select 1 from council_private.players where id=v_uid) then raise exception 'Choose your username first.'; end if;
  -- Pack row lock serializes author edits/publication with first attempt creation.
  select * into v_pack from council_private.packs where id=p_pack_id for update;
  if not found then raise exception 'Pack not found.'; end if;
  select id into v_a from council_private.attempts where player_id=v_uid and pack_id=p_pack_id and is_official for update;
  if v_a is null then
    if not v_pack.published then raise exception 'This pack is not open for play.'; end if;
    if (select count(*) from council_private.questions where pack_id=p_pack_id)<>7 then raise exception 'This pack is incomplete.'; end if;
    insert into council_private.attempts(player_id,pack_id,is_official,status,position,deadline)
      values(v_uid,p_pack_id,true,'active',0,clock_timestamp()+interval '25 seconds') returning id into v_a;
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
  perform 1 from council_private.packs where id=p_pack_id and published for share;
  if not found then raise exception 'This pack is not open for replays.'; end if;
  if not exists(select 1 from council_private.attempts where player_id=v_uid and pack_id=p_pack_id and is_official and status='completed') then
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

create or replace function public.council_results(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_a council_private.attempts; v_denominator bigint; v_questions jsonb;
begin
  perform council_private.owned_attempt(p_attempt_id);
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status<>'completed' then raise exception 'Finish all seven questions before viewing results.' using errcode='42501'; end if;
  select count(*) into v_denominator from council_private.attempts where pack_id=v_a.pack_id and status='completed' and is_official;
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
        where ps.question_id=q.id and ps.canonical_id=ans.id and ps.review_status='accepted' and pa.status='completed' and pa.is_official) ap on true
      where ans.question_id=q.id),'[]'::jsonb)
  ) order by q.position) into v_questions
  from council_private.questions q join council_private.submissions s on s.question_id=q.id and s.attempt_id=v_a.id
    left join council_private.accepted_answers ca on ca.id=s.canonical_id
    left join council_private.tiers awarded on awarded.points=s.points
    left join lateral(select count(*) n from council_private.submissions ps
      join council_private.attempts pa on pa.id=ps.attempt_id
      where ps.question_id=q.id and ps.canonical_id=s.canonical_id and ps.review_status='accepted' and pa.status='completed' and pa.is_official) pop on true
    where q.pack_id=v_a.pack_id;
  return jsonb_build_object('attemptId',v_a.id,'packId',v_a.pack_id,
    'isOfficial',v_a.is_official,
    'officialAttemptId',(select id from council_private.attempts where player_id=v_a.player_id and pack_id=v_a.pack_id and is_official),
    'officialScore',(select coalesce(sum(s.points),0) from council_private.attempts a join council_private.submissions s on s.attempt_id=a.id where a.player_id=v_a.player_id and a.pack_id=v_a.pack_id and a.is_official and a.status='completed'),
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
    where a.status='completed' and a.is_official and (p_pack_id is null or a.pack_id=p_pack_id)
    group by a.id,a.player_id
  ), totals as(
    select p.id,p.username,sum(a.score)::bigint score,count(*) games,sum(a.ones)::bigint ones,sum(a.pending)::bigint pending
    from per_attempt a join council_private.players p on p.id=a.player_id group by p.id,p.username
  ), ranked as(select *,rank() over(order by score desc) place from totals)
  select jsonb_agg(jsonb_build_object('rank',place,'username',username,'score',score,'games',games,'ones',ones,'pending',pending)
    order by score desc,lower(username),id) from ranked),'[]'::jsonb);
end;
$$;

create or replace function public.council_reviews() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform council_private.require_admin();
  return coalesce((select jsonb_agg(j order by is_pending desc,created_at desc,id) from(
    select s.id,s.created_at,s.review_status='pending' is_pending,jsonb_build_object(
      'id',s.id,'attemptId',s.attempt_id,'isOfficial',atp.is_official,'questionId',s.question_id,'prompt',q.prompt,
      'rawAnswer',s.raw_answer,'username',p.username,'reviewStatus',s.review_status,'canonical',ca.canonical,'points',s.points,
      'answers',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'canonical',a.canonical,'tier',a.tier,'points',t.points) order by t.points desc,lower(a.canonical),a.id)
        from council_private.accepted_answers a join council_private.tiers t on t.id=a.tier where a.question_id=s.question_id),'[]'::jsonb)
    ) j from council_private.submissions s
    join council_private.attempts atp on atp.id=s.attempt_id
    join council_private.players p on p.id=atp.player_id
    join council_private.questions q on q.id=s.question_id
    left join council_private.accepted_answers ca on ca.id=s.canonical_id
    order by (s.review_status='pending') desc,s.created_at desc,s.id limit 2000
  ) r),'[]'::jsonb);
end;
$$;

revoke all on function council_private.state_json(uuid) from public,anon,authenticated;
revoke execute on function public.council_practice(uuid,uuid) from public,anon;
grant execute on function public.council_practice(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
