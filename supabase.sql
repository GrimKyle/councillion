-- Councillion: run this entire file once in the Supabase SQL editor.
-- No trivia, account, or answer key is seeded. Public access is RPC-only.
begin;

create schema if not exists council_private;
revoke all on schema council_private from public, anon, authenticated;

create table if not exists council_private.tiers (
  id text primary key,
  name text not null,
  points integer not null unique check (points in (10,15,30,60,85,100)),
  color text not null
);
insert into council_private.tiers(id,name,points,color) values
 ('dino','Dino',10,'#A4B2C8'), ('kalen','Kalen',15,'#7ED7A5'),
 ('cavaughn','Cavaughn',30,'#60B9FF'), ('donovan','Donovan',60,'#BD8AFF'),
 ('grimkyle','Grimkyle',85,'#FA82BC'), ('councillion','One in a Councillion',100,'#FFD166')
on conflict(id) do update set name=excluded.name, points=excluded.points, color=excluded.color;

create table if not exists council_private.players (
  id uuid primary key references auth.users(id) on delete restrict,
  username text not null check (length(username) between 2 and 24),
  created_at timestamptz not null default now()
);
create unique index if not exists council_players_username on council_private.players(lower(username));
create table if not exists council_private.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists council_private.packs (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check(length(title)<=100),
  description text not null default '' check(length(description)<=1000),
  icon text not null default '🦃' check(length(icon)<=12),
  color text not null default '#BD8AFF' check(color ~ '^#[0-9a-fA-F]{6}$'),
  published boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table council_private.packs add column if not exists deleted_at timestamptz;
create table if not exists council_private.questions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references council_private.packs(id) on delete cascade,
  position integer not null check(position between 0 and 6),
  prompt text not null default '' check(length(prompt)<=1000),
  unique(pack_id,position), unique(id,pack_id)
);
create table if not exists council_private.accepted_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references council_private.questions(id) on delete cascade,
  canonical text not null check(length(trim(canonical)) between 1 and 200),
  tier text not null references council_private.tiers(id),
  explanation text not null default '' check(length(explanation)<=2000),
  unique(id,question_id)
);
create table if not exists council_private.aliases (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  answer_id uuid not null,
  alias text not null check(length(alias) between 1 and 200),
  normalized text not null check(length(normalized)>0),
  is_canonical boolean not null default false,
  foreign key(answer_id,question_id) references council_private.accepted_answers(id,question_id) on delete cascade,
  unique(question_id,normalized)
);
create table if not exists council_private.attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references council_private.players(id),
  pack_id uuid not null references council_private.packs(id),
  is_official boolean not null default true,
  status text not null check(status in ('active','between','completed')),
  position integer not null default 0 check(position between 0 and 6),
  deadline timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(id,pack_id),
  check((status='active')=(deadline is not null)),
  check((status='completed')=(completed_at is not null))
);
-- Existing first attempts remain official. Unlimited replay rows cannot enter
-- the unique first-attempt slot or be promoted by a client.
alter table council_private.attempts add column if not exists is_official boolean not null default true;
alter table council_private.attempts drop constraint if exists attempts_player_id_pack_id_key;
create unique index if not exists council_one_official_attempt
  on council_private.attempts(player_id,pack_id) where is_official;
-- Removed scores retain their official slot, preventing a fresh leaderboard attempt.
alter table council_private.attempts add column if not exists voided_at timestamptz;
alter table council_private.attempts add column if not exists voided_by uuid references auth.users(id);
alter table council_private.attempts add column if not exists void_reason text not null default '';
-- The author already knows the answers; existing author runs become practice too.
update council_private.attempts a set is_official=false
where exists(select 1 from council_private.admin_members gm where gm.user_id=a.player_id);

create table if not exists council_private.submissions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  pack_id uuid not null,
  question_id uuid not null,
  request_id uuid not null unique,
  raw_answer text not null default '' check(length(raw_answer)<=200),
  canonical_id uuid,
  review_status text not null check(review_status in ('accepted','pending','rejected','timeout')),
  points integer not null default 0 check(points in (0,10,15,30,60,85,100)),
  override_points integer check(override_points in (0,10,15,30,60,85,100)),
  review_note text not null default '' check(length(review_note)<=2000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  foreign key(attempt_id,pack_id) references council_private.attempts(id,pack_id),
  foreign key(question_id,pack_id) references council_private.questions(id,pack_id),
  foreign key(canonical_id,question_id) references council_private.accepted_answers(id,question_id),
  unique(attempt_id,question_id),
  check(review_status='accepted' or canonical_id is null)
);
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

create index if not exists council_submissions_question_answer on council_private.submissions(question_id,canonical_id);
create index if not exists council_submissions_pending on council_private.submissions(review_status) where review_status='pending';
create index if not exists council_attempts_pack_completed on council_private.attempts(pack_id) where status='completed';
create table if not exists council_private.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  target_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

-- RLS is defense in depth: no client policies or private schema privileges.
alter table council_private.tiers enable row level security;
alter table council_private.players enable row level security;
alter table council_private.admin_members enable row level security;
alter table council_private.packs enable row level security;
alter table council_private.questions enable row level security;
alter table council_private.accepted_answers enable row level security;
alter table council_private.aliases enable row level security;
alter table council_private.attempts enable row level security;
alter table council_private.submissions enable row level security;
alter table council_private.audit_log enable row level security;
alter table council_private.invalid_guesses enable row level security;
revoke all on all tables in schema council_private from public, anon, authenticated;
revoke all on all sequences in schema council_private from public, anon, authenticated;

create or replace function council_private.require_user() returns uuid
language plpgsql stable set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Sign in before using Councillion.' using errcode='28000'; end if;
  return v_uid;
end;
$$;
create or replace function council_private.is_admin() returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from council_private.admin_members where user_id=auth.uid());
$$;
create or replace function council_private.require_admin() returns uuid
language plpgsql stable set search_path='' as $$
declare v_uid uuid:=council_private.require_user();
begin
  if not council_private.is_admin() or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Game Master access required.' using errcode='42501';
  end if;
  return v_uid;
end;
$$;
create or replace function council_private.normalize_answer(p_text text) returns text
language sql immutable strict set search_path='' as $$
  select regexp_replace(regexp_replace(lower(pg_catalog.normalize(p_text,'NFKD')),U&'[\0300-\036f]','','g'),'[^[:alnum:]]','','g');
$$;

-- Bounded Damerau distance: equal=0, one insert/delete/substitute/swap=1,
-- otherwise=2. No extension or external API required.
create or replace function council_private.typo_distance(p_left text,p_right text) returns integer
language plpgsql immutable strict parallel safe set search_path='' as $$
declare v_l integer:=length(p_left); v_r integer:=length(p_right); v_i integer:=1;
  v_short text; v_long text;
begin
  if p_left=p_right then return 0; end if;
  if abs(v_l-v_r)>1 then return 2; end if;
  while v_i<=least(v_l,v_r) and substr(p_left,v_i,1)=substr(p_right,v_i,1) loop
    v_i:=v_i+1;
  end loop;
  if v_l=v_r then
    if substr(p_left,v_i+1)=substr(p_right,v_i+1) then return 1; end if;
    if v_i<v_l and substr(p_left,v_i,1)=substr(p_right,v_i+1,1)
      and substr(p_left,v_i+1,1)=substr(p_right,v_i,1)
      and substr(p_left,v_i+2)=substr(p_right,v_i+2) then return 1; end if;
    return 2;
  end if;
  if v_l<v_r then v_short:=p_left; v_long:=p_right;
  else v_short:=p_right; v_long:=p_left; end if;
  if substr(v_short,v_i)=substr(v_long,v_i+1) then return 1; end if;
  return 2;
end;
$$;

create or replace function council_private.match_answer(p_question_id uuid,p_raw text) returns uuid
language plpgsql stable strict set search_path='' as $$
declare v_normalized text:=council_private.normalize_answer(p_raw); v_exact uuid;
  v_candidates uuid[]; v_eligible boolean;
begin
  select answer_id into v_exact from council_private.aliases
    where question_id=p_question_id and normalized=v_normalized;
  if found then return v_exact; end if;
  if length(v_normalized)<4 then return null; end if;
  select array_agg(answer_id order by answer_id),bool_and(eligible)
    into v_candidates,v_eligible from (
      select answer_id,bool_or(length(normalized)>=5) eligible
      from council_private.aliases
      where question_id=p_question_id
        and length(normalized) between length(v_normalized)-1 and length(v_normalized)+1
        and council_private.typo_distance(v_normalized,normalized)=1
      group by answer_id
    ) candidates;
  -- Several nearby spellings for one canonical answer still count as one.
  -- Short competitors veto ambiguity even though they cannot auto-correct alone.
  if cardinality(v_candidates)=1 and v_eligible then return v_candidates[1]; end if;
  return null;
end;
$$;

create or replace function public.council_profile() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user(); v_player council_private.players;
begin
  select * into v_player from council_private.players where id=v_uid;
  if not found then
    if council_private.is_admin() then return jsonb_build_object('id',v_uid,'username','Game Master','isAdmin',true); end if;
    return null;
  end if;
  return jsonb_build_object('id',v_player.id,'username',v_player.username,'isAdmin',council_private.is_admin());
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

-- Caller holds the attempt row lock. Deadline and scoring are never client supplied.
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

create or replace function council_private.require_open_pack(p_pack_id uuid) returns void
language plpgsql stable set search_path='' as $$
begin
  if not exists(select 1 from council_private.packs where id=p_pack_id and published and deleted_at is null) then
    raise exception 'This pack is private or has been deleted.' using errcode='42501';
  end if;
end;
$$;

create or replace function council_private.owned_attempt(p_attempt_id uuid) returns void
language plpgsql set search_path='' as $$
declare v_uid uuid:=council_private.require_user(); v_a council_private.attempts;
begin
  select * into v_a from council_private.attempts where id=p_attempt_id and player_id=v_uid for update;
  if not found then raise exception 'Attempt not found.' using errcode='42501'; end if;
  if v_a.status<>'completed' then perform council_private.require_open_pack(v_a.pack_id); end if;
end;
$$;
create or replace function council_private.expire_attempt(p_attempt_id uuid) returns void
language plpgsql set search_path='' as $$
declare v_a council_private.attempts;
begin
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status='active' and clock_timestamp()>=v_a.deadline then
    perform council_private.lock_answer(v_a.id,'',gen_random_uuid(),true);
  end if;
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
create or replace function public.council_state(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform council_private.owned_attempt(p_attempt_id);
  perform council_private.expire_attempt(p_attempt_id);
  return council_private.state_json(p_attempt_id);
end;
$$;
create or replace function public.council_next(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_a council_private.attempts;
begin
  perform council_private.owned_attempt(p_attempt_id);
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  -- Repeated calls while active keep the deadline; expired active calls only expire.
  if v_a.status='active' then perform council_private.expire_attempt(p_attempt_id);
  elsif v_a.status='between' then
    update council_private.attempts set status='active',deadline=clock_timestamp()+interval '25 seconds' where id=p_attempt_id;
  end if;
  return council_private.state_json(p_attempt_id);
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

-- Administrative RPCs follow below. They never authorize using player-editable metadata.
create or replace function council_private.pack_editor(p_pack_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',p.id,'title',p.title,'description',p.description,'icon',p.icon,'color',p.color,'published',p.published,
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'prompt',q.prompt,
      'answers',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'canonical',a.canonical,'tier',a.tier,'explanation',a.explanation,
        'aliases',coalesce((select jsonb_agg(al.alias order by lower(al.alias),al.id) from council_private.aliases al where al.answer_id=a.id and not al.is_canonical),'[]'::jsonb)
      ) order by lower(a.canonical),a.id) from council_private.accepted_answers a where a.question_id=q.id),'[]'::jsonb)
    ) order by q.position) from council_private.questions q where q.pack_id=p.id),'[]'::jsonb)
  ) from council_private.packs p where p.id=p_pack_id;
$$;

create or replace function public.council_admin_get(p_pack_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_pack jsonb;
begin
  perform council_private.require_admin();
  if not exists(select 1 from council_private.packs where id=p_pack_id and deleted_at is null) then raise exception 'Pack not found.'; end if;
  v_pack:=council_private.pack_editor(p_pack_id);
  if v_pack is null then raise exception 'Pack not found.'; end if;
  return v_pack;
end;
$$;

-- Internal answer-key insertion; duplicates for one answer are harmless, cross-answer
-- collisions are rejected. Used for unpublished packs and explicit review corrections.
create or replace function council_private.add_answer(p_question_id uuid,p_answer jsonb) returns uuid
language plpgsql set search_path='' as $$
declare v_id uuid; v_canonical text:=trim(p_answer->>'canonical'); v_tier text:=p_answer->>'tier';
  v_explanation text:=coalesce(p_answer->>'explanation',''); v_alias text; v_norm text; v_other uuid;
begin
  if p_answer is null or jsonb_typeof(p_answer) is distinct from 'object' then raise exception 'Accepted answers must be JSON objects.'; end if;
  if v_canonical is null or length(v_canonical) not between 1 and 200 or length(council_private.normalize_answer(v_canonical))=0 then
    raise exception 'Every accepted answer needs a name of 1–200 letters/numbers.';
  end if;
  if not exists(select 1 from council_private.tiers where id=v_tier) then raise exception 'Unknown rarity tier.'; end if;
  if length(v_explanation)>2000 then raise exception 'Answer explanations must be 2000 characters or fewer.'; end if;
  if jsonb_typeof(coalesce(p_answer->'aliases','[]'::jsonb)) is distinct from 'array' then raise exception 'Answer aliases must be an array.'; end if;
  if jsonb_array_length(coalesce(p_answer->'aliases','[]'::jsonb))>100 then raise exception 'Limit each answer to 100 aliases.'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_answer->'aliases','[]'::jsonb)) where jsonb_typeof(value) is distinct from 'string') then
    raise exception 'Each alias must be a text string.';
  end if;
  v_id:=coalesce(nullif(p_answer->>'id','')::uuid,gen_random_uuid());
  if exists(select 1 from council_private.accepted_answers where id=v_id) then raise exception 'Answer ID already exists.'; end if;
  insert into council_private.accepted_answers(id,question_id,canonical,tier,explanation)
    values(v_id,p_question_id,v_canonical,v_tier,v_explanation);
  insert into council_private.aliases(question_id,answer_id,alias,normalized,is_canonical)
    values(p_question_id,v_id,v_canonical,council_private.normalize_answer(v_canonical),true);
  for v_alias in select jsonb_array_elements_text(coalesce(p_answer->'aliases','[]'::jsonb)) loop
    v_alias:=trim(v_alias);
    if v_alias='' then continue; end if;
    v_norm:=council_private.normalize_answer(v_alias);
    if length(v_alias)>200 or length(v_norm)=0 then raise exception 'Aliases need 1–200 visible letters/numbers.'; end if;
    select answer_id into v_other from council_private.aliases where question_id=p_question_id and normalized=v_norm;
    if v_other=v_id then continue; end if;
    if v_other is not null then raise exception 'Two answers have colliding names or aliases: %',v_alias; end if;
    insert into council_private.aliases(question_id,answer_id,alias,normalized) values(p_question_id,v_id,v_alias,v_norm);
  end loop;
  return v_id;
exception when unique_violation then
  raise exception 'Two answers have colliding names or aliases after normalization.';
end;
$$;

create or replace function council_private.validate_published_pack(p_pack_id uuid) returns void
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from council_private.packs where id=p_pack_id and length(trim(title))>0) then
    raise exception 'Give the pack a title before publishing.';
  end if;
  if (select count(*) from council_private.questions where pack_id=p_pack_id)<>7 then
    raise exception 'A published pack must contain exactly seven questions.';
  end if;
  if exists(select 1 from council_private.questions q where q.pack_id=p_pack_id and
    (length(trim(q.prompt))=0 or not exists(select 1 from council_private.accepted_answers a where a.question_id=q.id))) then
    raise exception 'Every question needs a prompt and at least one accepted answer before publishing.';
  end if;
  if exists(select 1 from council_private.accepted_answers a join council_private.questions q on q.id=a.question_id
    where q.pack_id=p_pack_id and a.tier='councillion' and length(trim(a.explanation))=0) then
    raise exception 'Every One in a Councillion answer needs its explanation before publishing.';
  end if;
end;
$$;

create or replace function public.council_admin_visibility(p_pack_id uuid,p_published boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_admin(); v_old jsonb;
begin
  if p_published is null then raise exception 'Choose public or private.'; end if;
  select to_jsonb(p) into v_old from council_private.packs p where id=p_pack_id and deleted_at is null for update;
  if not found then raise exception 'Pack not found.'; end if;
  if p_published then perform council_private.validate_published_pack(p_pack_id); end if;
  update council_private.packs set published=p_published,updated_at=clock_timestamp() where id=p_pack_id;
  insert into council_private.audit_log(actor_id,action,target_id,before_value,after_value)
    values(v_uid,case when p_published then 'pack.publish' else 'pack.private' end,p_pack_id,v_old,jsonb_build_object('published',p_published));
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.council_admin_delete(p_pack_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_admin(); v_old jsonb;
begin
  select to_jsonb(p) into v_old from council_private.packs p where id=p_pack_id for update;
  if not found then raise exception 'Pack not found.'; end if;
  update council_private.packs set published=false,deleted_at=coalesce(deleted_at,clock_timestamp()),updated_at=clock_timestamp() where id=p_pack_id;
  insert into council_private.audit_log(actor_id,action,target_id,before_value,after_value)
    values(v_uid,'pack.delete',p_pack_id,v_old,jsonb_build_object('deleted',true));
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.council_admin_save(p_pack jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_admin(); v_id uuid; v_old jsonb; v_new jsonb; v_q jsonb; v_ans jsonb;
  v_qid uuid; v_i integer:=0; v_pub boolean; v_locked boolean; v_title text; v_desc text; v_icon text; v_color text;
begin
  if p_pack is null or jsonb_typeof(p_pack) is distinct from 'object' then raise exception 'Pack must be a JSON object.'; end if;
  if jsonb_typeof(p_pack->'questions') is distinct from 'array' then raise exception 'Pack questions must be an array.'; end if;
  if jsonb_array_length(p_pack->'questions')>7 then raise exception 'A pack can have at most seven questions.'; end if;
  v_id:=coalesce(nullif(p_pack->>'id','')::uuid,gen_random_uuid());
  v_pub:=coalesce((p_pack->>'published')::boolean,false);
  v_title:=coalesce(trim(p_pack->>'title'),''); v_desc:=coalesce(p_pack->>'description','');
  v_icon:=coalesce(nullif(p_pack->>'icon',''),'🦃'); v_color:=coalesce(nullif(p_pack->>'color',''),'#BD8AFF');
  if length(v_title)>100 or length(v_desc)>1000 or length(v_icon)>12 or v_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Invalid pack title, description, icon, or color.';
  end if;
  perform 1 from council_private.packs where id=v_id for update;
  if exists(select 1 from council_private.packs where id=v_id and deleted_at is not null) then raise exception 'This pack has been deleted.'; end if;
  v_old:=council_private.pack_editor(v_id);
  select exists(select 1 from council_private.attempts where pack_id=v_id) into v_locked;
  if v_locked and (v_old->'questions') is distinct from (p_pack->'questions') then
    raise exception 'This pack has been played. Questions and answer keys are locked; use answer review for corrections or create a new pack.';
  end if;
  insert into council_private.packs(id,title,description,icon,color,published,created_by)
    values(v_id,v_title,v_desc,v_icon,v_color,false,v_uid)
    on conflict(id) do update set title=excluded.title,description=excluded.description,icon=excluded.icon,color=excluded.color,updated_at=clock_timestamp();
  if not v_locked then
    delete from council_private.questions where pack_id=v_id;
    for v_q in select value from jsonb_array_elements(p_pack->'questions') loop
      if jsonb_typeof(v_q) is distinct from 'object' or length(coalesce(v_q->>'prompt',''))>1000 or jsonb_typeof(v_q->'answers') is distinct from 'array' then
        raise exception 'Each question needs a prompt and an answer array.';
      end if;
      if jsonb_array_length(v_q->'answers')>1000 then raise exception 'Limit each question to 1000 accepted answers.'; end if;
      v_qid:=coalesce(nullif(v_q->>'id','')::uuid,gen_random_uuid());
      if exists(select 1 from council_private.questions where id=v_qid) then raise exception 'Question ID belongs to another pack.'; end if;
      insert into council_private.questions(id,pack_id,position,prompt) values(v_qid,v_id,v_i,coalesce(v_q->>'prompt',''));
      for v_ans in select value from jsonb_array_elements(v_q->'answers') loop
        -- Empty editor rows may be saved in drafts; they never become accepted answers.
        if length(trim(coalesce(v_ans->>'canonical','')))=0 and not v_pub then continue; end if;
        perform council_private.add_answer(v_qid,v_ans);
      end loop;
      v_i:=v_i+1;
    end loop;
  end if;
  if v_pub then perform council_private.validate_published_pack(v_id); end if;
  update council_private.packs set published=v_pub,updated_at=clock_timestamp() where id=v_id;
  v_new:=council_private.pack_editor(v_id);
  insert into council_private.audit_log(actor_id,action,target_id,before_value,after_value)
    values(v_uid,case when v_old is null then 'pack.create' else 'pack.save' end,v_id,v_old,v_new);
  return v_new;
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

create or replace function public.council_review(
  p_submission_id uuid,p_answer_id uuid default null,p_reject boolean default false,
  p_override_points integer default null,p_note text default '',
  p_new_answer jsonb default null,p_apply_to_matching boolean default true
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_admin(); v_s council_private.submissions; v_answer_id uuid:=p_answer_id;
  v_tier text; v_points integer; v_before jsonb; v_after jsonb; v_n integer; v_existing uuid; v_normalized text;
begin
  select * into v_s from council_private.submissions where id=p_submission_id;
  if not found then raise exception 'Submission not found.'; end if;
  -- All reviews for one question serialize, including grouped approvals.
  perform 1 from council_private.questions where id=v_s.question_id for update;
  select * into strict v_s from council_private.submissions where id=p_submission_id for update;
  if coalesce(p_reject,false) and (p_answer_id is not null or p_new_answer is not null or coalesce(p_override_points,0)<>0) then
    raise exception 'A rejection cannot also approve an answer or award points.';
  end if;
  if p_override_points is not null and p_override_points not in (0,10,15,30,60,85,100) then raise exception 'Invalid score override.'; end if;
  if length(coalesce(p_note,''))>2000 then raise exception 'Review notes must be 2000 characters or fewer.'; end if;
  if p_new_answer is not null then
    if p_answer_id is not null then raise exception 'Choose an existing answer or create a new answer, not both.'; end if;
    if (p_new_answer->>'tier')='councillion' and length(trim(coalesce(p_new_answer->>'explanation','')))=0 then
      raise exception 'One in a Councillion answers need their special explanation.';
    end if;
    v_answer_id:=council_private.add_answer(v_s.question_id,p_new_answer-'id');
  end if;
  if not coalesce(p_reject,false) and v_answer_id is null then
    -- A point-only correction retains the recognized canonical answer.
    v_answer_id:=v_s.canonical_id;
    if v_answer_id is null and p_override_points is null then raise exception 'Choose an answer, create one, or reject the submission.'; end if;
  end if;
  if v_answer_id is not null then
    select a.tier,t.points into v_tier,v_points from council_private.accepted_answers a join council_private.tiers t on t.id=a.tier
      where a.id=v_answer_id and a.question_id=v_s.question_id;
    if not found then raise exception 'The selected answer belongs to a different question.'; end if;
  else v_points:=0;
  end if;
  v_points:=coalesce(p_override_points,v_points,0);
  if coalesce(p_reject,false) then v_answer_id:=null; v_points:=0; end if;
  v_normalized:=council_private.normalize_answer(v_s.raw_answer);
  -- A reusable approval records the spelling as a configured alias. It never
  -- replaces an existing alias assigned to a different canonical answer.
  if coalesce(p_apply_to_matching,true) and v_answer_id is not null and length(v_normalized)>0 then
    select answer_id into v_existing from council_private.aliases where question_id=v_s.question_id and normalized=v_normalized;
    if v_existing is not null and v_existing<>v_answer_id then
      raise exception 'This spelling already belongs to another answer. Disable apply-to-matching for an individual correction.';
    end if;
    insert into council_private.aliases(question_id,answer_id,alias,normalized)
      values(v_s.question_id,v_answer_id,v_s.raw_answer,v_normalized) on conflict(question_id,normalized) do nothing;
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into v_before from council_private.submissions s where
    s.id=v_s.id or (coalesce(p_apply_to_matching,true) and length(v_normalized)>0 and s.question_id=v_s.question_id
      and (s.review_status='pending' or (s.review_status='rejected' and s.reviewed_at is null)) and council_private.normalize_answer(s.raw_answer)=v_normalized);
  update council_private.submissions s set
    canonical_id=v_answer_id,
    review_status=case when coalesce(p_reject,false) then 'rejected' when v_answer_id is null then 'rejected' else 'accepted' end,
    points=v_points,override_points=p_override_points,review_note=coalesce(p_note,''),reviewed_at=clock_timestamp()
    where s.id=v_s.id or (coalesce(p_apply_to_matching,true) and length(v_normalized)>0 and s.question_id=v_s.question_id
      and (s.review_status='pending' or (s.review_status='rejected' and s.reviewed_at is null)) and council_private.normalize_answer(s.raw_answer)=v_normalized);
  get diagnostics v_n=row_count;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into v_after from council_private.submissions s
    where s.id in(select (value->>'id')::uuid from jsonb_array_elements(v_before));
  insert into council_private.audit_log(actor_id,action,target_id,before_value,after_value)
    values(v_uid,'submission.review',v_s.id,v_before,v_after);
  if p_new_answer is not null then
    insert into council_private.audit_log(actor_id,action,target_id,after_value)
      values(v_uid,'answer.create_from_review',v_answer_id,p_new_answer);
  end if;
  return jsonb_build_object('ok',true,'updatedCount',v_n,'answerId',v_answer_id);
end;
$$;

-- Changes the canonical rarity for all recognized submissions while preserving
-- explicit per-submission overrides. Scores/achievements/ranks are derived from
-- submissions, so there are no stale aggregate tables to rebuild.
create or replace function public.council_regrade_answer(p_answer_id uuid,p_tier text,p_explanation text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_admin(); v_answer council_private.accepted_answers;
  v_points integer; v_old jsonb; v_new jsonb; v_count integer; v_explanation text:=coalesce(p_explanation,'');
begin
  select * into v_answer from council_private.accepted_answers where id=p_answer_id;
  if not found then raise exception 'Accepted answer not found.'; end if;
  perform 1 from council_private.questions where id=v_answer.question_id for update;
  select * into strict v_answer from council_private.accepted_answers where id=p_answer_id for update;
  select points into v_points from council_private.tiers where id=p_tier;
  if not found then raise exception 'Unknown rarity tier.'; end if;
  if length(v_explanation)>2000 then raise exception 'Explanations must be 2000 characters or fewer.'; end if;
  if p_tier='councillion' and length(trim(v_explanation))=0 then raise exception 'One in a Councillion answers need their special explanation.'; end if;
  v_old:=to_jsonb(v_answer);
  update council_private.accepted_answers set tier=p_tier,explanation=v_explanation where id=p_answer_id;
  update council_private.submissions set points=v_points
    where canonical_id=p_answer_id and review_status='accepted' and override_points is null;
  get diagnostics v_count=row_count;
  select to_jsonb(a) into v_new from council_private.accepted_answers a where id=p_answer_id;
  insert into council_private.audit_log(actor_id,action,target_id,before_value,after_value)
    values(v_uid,'answer.regrade',p_answer_id,v_old,v_new||jsonb_build_object('updatedSubmissionCount',v_count));
  return jsonb_build_object('ok',true,'updatedCount',v_count,'answerId',p_answer_id,'tier',p_tier,'points',v_points);
end;
$$;

-- Explicitly remove PostgreSQL's default PUBLIC execute grant. The anonymous
-- API key cannot run these RPCs until Supabase Auth has created a user session.
revoke all on all functions in schema council_private from public, anon, authenticated;
revoke execute on function public.council_profile() from public, anon;
revoke execute on function public.council_enter(text) from public, anon;
revoke execute on function public.council_packs(boolean) from public, anon;
revoke execute on function public.council_begin(uuid) from public, anon;
revoke execute on function public.council_practice(uuid,uuid) from public, anon;
revoke execute on function public.council_state(uuid) from public, anon;
revoke execute on function public.council_next(uuid) from public, anon;
revoke execute on function public.council_answer(uuid,uuid,text,uuid) from public, anon;
revoke execute on function public.council_results(uuid) from public, anon;
revoke execute on function public.council_leaderboard(uuid) from public, anon;
revoke execute on function public.council_admin_get(uuid) from public, anon;
revoke execute on function public.council_admin_save(jsonb) from public, anon;
revoke execute on function public.council_admin_visibility(uuid,boolean) from public, anon;
revoke execute on function public.council_admin_delete(uuid) from public, anon;
revoke execute on function public.council_reviews() from public, anon;
revoke execute on function public.council_review(uuid,uuid,boolean,integer,text,jsonb,boolean) from public, anon;
revoke execute on function public.council_regrade_answer(uuid,text,text) from public, anon;
grant execute on function public.council_profile() to authenticated;
grant execute on function public.council_enter(text) to authenticated;
grant execute on function public.council_packs(boolean) to authenticated;
grant execute on function public.council_begin(uuid) to authenticated;
grant execute on function public.council_practice(uuid,uuid) to authenticated;
grant execute on function public.council_state(uuid) to authenticated;
grant execute on function public.council_next(uuid) to authenticated;
grant execute on function public.council_answer(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.council_results(uuid) to authenticated;
grant execute on function public.council_leaderboard(uuid) to authenticated;
grant execute on function public.council_admin_get(uuid) to authenticated;
grant execute on function public.council_admin_save(jsonb) to authenticated;
grant execute on function public.council_admin_visibility(uuid,boolean) to authenticated;
grant execute on function public.council_admin_delete(uuid) to authenticated;
grant execute on function public.council_reviews() to authenticated;
grant execute on function public.council_review(uuid,uuid,boolean,integer,text,jsonb,boolean) to authenticated;
grant execute on function public.council_regrade_answer(uuid,text,text) to authenticated;


revoke all on function council_private.submit_answer(uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.council_confirm_answer(uuid,uuid,text,uuid) from public,anon;
revoke execute on function public.council_resume(uuid,uuid) from public,anon;
grant execute on function public.council_confirm_answer(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.council_resume(uuid,uuid) to authenticated;

-- Supabase/PostgREST sees the new RPC signatures immediately after commit.
notify pgrst, 'reload schema';
commit;

-- ONE-TIME GAME MASTER BOOTSTRAP (run separately, using your permanent Auth user UUID):
-- insert into council_private.admin_members(user_id) values ('YOUR-AUTH-USER-UUID');
