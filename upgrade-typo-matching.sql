-- Councillion automatic matching upgrade: run AFTER the original supabase.sql.
-- No packs, players or submissions are deleted; historical scores are preserved.
-- New submissions receive automatic final scores, with no manual review gate.
-- Fresh projects: use the updated supabase.sql instead.
begin;

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

create or replace function council_private.lock_answer(p_attempt_id uuid,p_answer text,p_request_id uuid,p_timeout boolean) returns void
language plpgsql set search_path='' as $$
declare v_a council_private.attempts; v_q uuid; v_match uuid; v_points integer; v_status text; v_raw text:=coalesce(trim(p_answer),'');
begin
  select * into strict v_a from council_private.attempts where id=p_attempt_id;
  if v_a.status<>'active' then raise exception 'No active question.'; end if;
  select id into strict v_q from council_private.questions where pack_id=v_a.pack_id and position=v_a.position for share;
  if p_timeout then v_raw:=''; v_status:='timeout'; v_points:=0;
  elsif v_raw='' then v_status:='rejected'; v_points:=0;
  else
    v_match:=council_private.match_answer(v_q,v_raw);
    select t.points into v_points from council_private.accepted_answers ca
      join council_private.tiers t on t.id=ca.tier where ca.id=v_match;
    -- Automatic final decision: unknown/ambiguous answers score zero. No review gate.
    if v_match is null then v_status:='rejected'; v_points:=0; else v_status:='accepted'; end if;
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

revoke all on function council_private.typo_distance(text,text) from public,anon,authenticated;
revoke all on function council_private.match_answer(uuid,text) from public,anon,authenticated;
revoke all on function council_private.lock_answer(uuid,text,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.council_review(uuid,uuid,boolean,integer,text,jsonb,boolean) from public,anon;
grant execute on function public.council_review(uuid,uuid,boolean,integer,text,jsonb,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
