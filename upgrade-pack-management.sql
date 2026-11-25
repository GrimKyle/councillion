-- Councillion pack-management upgrade. Run AFTER earlier typo/replay upgrades.
-- Fresh projects need only the latest full supabase.sql.
-- Deletion hides a pack and blocks play; historical data is retained.
begin;
alter table council_private.packs add column if not exists deleted_at timestamptz;

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
  ) order by p.created_at,p.id) from council_private.packs p where p.deleted_at is null and (p.published or p_admin)),'[]'::jsonb);
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

create or replace function public.council_begin(p_pack_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=council_private.require_user(); v_a uuid; v_pack council_private.packs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));
  if not exists(select 1 from council_private.players where id=v_uid) then raise exception 'Choose your username first.'; end if;
  -- Pack row lock serializes author edits/publication with first attempt creation.
  select * into v_pack from council_private.packs where id=p_pack_id for update;
  if not found then raise exception 'Pack not found.'; end if;
  perform council_private.require_open_pack(p_pack_id);
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
  perform 1 from council_private.packs where id=p_pack_id and published and deleted_at is null for share;
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

revoke all on function council_private.require_open_pack(uuid) from public,anon,authenticated;
revoke execute on function public.council_admin_visibility(uuid,boolean) from public,anon;
revoke execute on function public.council_admin_delete(uuid) from public,anon;
grant execute on function public.council_admin_visibility(uuid,boolean) to authenticated;
grant execute on function public.council_admin_delete(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
