begin;

create or replace function revenue_lab.youtube_query_fingerprint(p_query_text text)
returns text language sql immutable strict security invoker set search_path = '' as $$
  select encode(extensions.digest(convert_to(lower(regexp_replace(btrim(p_query_text), '\s+', ' ', 'g')), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function revenue_lab.enqueue_youtube_job(p_source_query_id uuid, p_requested_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result revenue_lab.jobs;
declare was_created boolean := false;
declare query_project_id uuid;
declare query_fingerprint text;
declare idempotency_value text;
begin
  select s.project_id, revenue_lab.youtube_query_fingerprint(q.query_text)
  into query_project_id, query_fingerprint
  from revenue_lab.source_queries q
  join revenue_lab.sources s on s.id = q.source_id
  join revenue_lab.projects p on p.id = s.project_id
  where q.id = p_source_query_id and q.enabled and s.enabled and p.active;

  if query_project_id is null then raise exception 'Enabled source query was not found' using errcode = 'P0002'; end if;
  idempotency_value := 'youtube-discovery:' || p_source_query_id::text || ':' || p_requested_day::text || ':' || query_fingerprint;

  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
  values (query_project_id, 'youtube.collect', jsonb_build_object(
    'source_query_id', p_source_query_id, 'requested_day', p_requested_day, 'query_fingerprint', query_fingerprint
  ), idempotency_value)
  on conflict (idempotency_key) do nothing returning * into result;

  if result.id is not null then
    was_created := true;
  else
    select * into result from revenue_lab.jobs where idempotency_key = idempotency_value;
  end if;
  if result.id is null then raise exception 'Discovery job could not be resolved'; end if;
  return jsonb_build_object('id', result.id, 'status', result.status, 'created', was_created, 'query_fingerprint', query_fingerprint);
end;
$$;

create or replace function revenue_lab.enqueue_daily_youtube_jobs(p_day date default (now() at time zone 'Asia/Tokyo')::date)
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
  select s.project_id, 'youtube.collect', jsonb_build_object(
      'source_query_id', q.id, 'requested_day', p_day,
      'query_fingerprint', revenue_lab.youtube_query_fingerprint(q.query_text)
    ),
    'youtube-discovery:' || q.id::text || ':' || p_day::text || ':' || revenue_lab.youtube_query_fingerprint(q.query_text)
  from revenue_lab.source_queries q
  join revenue_lab.sources s on s.id = q.source_id
  join revenue_lab.projects p on p.id = s.project_id
  where q.enabled and s.enabled and p.active
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function revenue_lab.youtube_query_fingerprint(text) from public, anon, authenticated;
revoke all on function revenue_lab.enqueue_youtube_job(uuid, date) from public, anon, authenticated;
revoke all on function revenue_lab.enqueue_daily_youtube_jobs(date) from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_youtube_job(uuid, date) to service_role;
grant execute on function revenue_lab.enqueue_daily_youtube_jobs(date) to service_role;

commit;
