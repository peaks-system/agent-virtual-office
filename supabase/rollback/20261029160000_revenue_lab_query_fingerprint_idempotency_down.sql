begin;

create or replace function revenue_lab.enqueue_youtube_job(p_source_query_id uuid, p_requested_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result revenue_lab.jobs;
declare was_created boolean := false;
begin
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
  select s.project_id, 'youtube.collect', jsonb_build_object('source_query_id', q.id, 'requested_day', p_requested_day),
    'youtube.collect:' || q.id::text || ':' || p_requested_day::text
  from revenue_lab.source_queries q join revenue_lab.sources s on s.id = q.source_id
  join revenue_lab.projects p on p.id = s.project_id
  where q.id = p_source_query_id and q.enabled and s.enabled and p.active
  on conflict (idempotency_key) do nothing returning * into result;
  if result.id is not null then
    was_created := true;
  else
    select * into result from revenue_lab.jobs
    where idempotency_key = 'youtube.collect:' || p_source_query_id::text || ':' || p_requested_day::text;
  end if;
  if result.id is null then raise exception 'Enabled source query was not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', result.id, 'status', result.status, 'created', was_created);
end;
$$;

create or replace function revenue_lab.enqueue_daily_youtube_jobs(p_day date default (now() at time zone 'Asia/Tokyo')::date)
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
  select s.project_id, 'youtube.collect', jsonb_build_object('source_query_id', q.id, 'requested_day', p_day),
    'youtube.collect:' || q.id::text || ':' || p_day::text
  from revenue_lab.source_queries q join revenue_lab.sources s on s.id = q.source_id
  join revenue_lab.projects p on p.id = s.project_id
  where q.enabled and s.enabled and p.active
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

drop function if exists revenue_lab.youtube_query_fingerprint(text);

commit;
