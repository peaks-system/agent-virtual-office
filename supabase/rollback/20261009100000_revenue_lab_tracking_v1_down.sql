begin;
delete from revenue_lab.jobs where job_type = 'youtube.track';
drop function if exists revenue_lab.enqueue_tracking_jobs(date);
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
drop function if exists revenue_lab.mark_tracking_targets_seen(uuid[], timestamptz);
drop function if exists revenue_lab.mark_tracking_targets_missing(uuid[]);
drop function if exists revenue_lab.tracking_candidates(uuid, date, timestamptz);
drop function if exists revenue_lab.upsert_tracking_targets(uuid, uuid[], timestamptz, uuid);
drop table if exists revenue_lab.tracking_opportunities;
drop table if exists revenue_lab.tracking_run_items;
drop table if exists revenue_lab.tracking_runs;
drop table if exists revenue_lab.tracking_targets;
alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check check (job_type in ('youtube.collect'));
alter table revenue_lab.source_item_snapshots drop constraint source_item_snapshots_capture_job_key;
drop index if exists revenue_lab.source_item_snapshots_kind_idx;
alter table revenue_lab.source_item_snapshots drop column capture_job_id, drop column capture_kind;
commit;
