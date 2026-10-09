begin;

alter table revenue_lab.source_item_snapshots
  add column capture_kind text not null default 'discovery'
    check (capture_kind in ('discovery', 'tracking')),
  add column capture_job_id uuid references revenue_lab.jobs(id) on delete set null;
alter table revenue_lab.source_item_snapshots
  add constraint source_item_snapshots_capture_job_key unique (source_item_id, capture_job_id);
create index source_item_snapshots_kind_idx
  on revenue_lab.source_item_snapshots(source_item_id, capture_kind, captured_at desc);

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track'));

create table revenue_lab.tracking_targets (
  id uuid primary key default gen_random_uuid(),
  source_query_id uuid not null references revenue_lab.source_queries(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  origin_collection_run_id uuid references revenue_lab.collection_runs(id) on delete set null,
  first_discovered_at timestamptz not null,
  last_discovered_at timestamptz not null,
  tracking_until timestamptz not null,
  status text not null default 'active' check (status in ('active', 'retired', 'expired')),
  missing_count smallint not null default 0 check (missing_count between 0 and 3),
  last_tracked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_query_id, source_item_id)
);
create index tracking_targets_active_idx on revenue_lab.tracking_targets(status, tracking_until, source_query_id);
create index tracking_targets_item_idx on revenue_lab.tracking_targets(source_item_id);
create index tracking_targets_origin_run_idx on revenue_lab.tracking_targets(origin_collection_run_id);

create table revenue_lab.tracking_runs (
  id uuid primary key default gen_random_uuid(),
  source_query_id uuid not null references revenue_lab.source_queries(id) on delete cascade,
  job_id uuid not null references revenue_lab.jobs(id) on delete cascade,
  requested_day date not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  captured_at timestamptz not null,
  target_count smallint not null default 0,
  received_count smallint not null default 0,
  scored_count smallint not null default 0,
  waiting_count smallint not null default 0,
  missing_count smallint not null default 0,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, source_query_id)
);
create index tracking_runs_query_idx on revenue_lab.tracking_runs(source_query_id, captured_at desc);
create index tracking_runs_job_idx on revenue_lab.tracking_runs(job_id);

create table revenue_lab.tracking_run_items (
  id uuid primary key default gen_random_uuid(),
  tracking_run_id uuid not null references revenue_lab.tracking_runs(id) on delete cascade,
  tracking_target_id uuid not null references revenue_lab.tracking_targets(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  previous_snapshot_id uuid references revenue_lab.source_item_snapshots(id) on delete set null,
  current_snapshot_id uuid references revenue_lab.source_item_snapshots(id) on delete set null,
  status text not null check (status in ('scored', 'waiting_interval', 'missing', 'unscored')),
  previous_view_count bigint check (previous_view_count >= 0),
  current_view_count bigint check (current_view_count >= 0),
  view_delta bigint check (view_delta >= 0),
  elapsed_hours numeric(30,6) check (elapsed_hours >= 0),
  views_velocity numeric(30,6) check (views_velocity >= 0),
  growth_ratio numeric(30,6) check (growth_ratio >= 0),
  growth_percent numeric(30,6) check (growth_percent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tracking_run_id, source_item_id)
);
create index tracking_run_items_target_idx on revenue_lab.tracking_run_items(tracking_target_id);
create index tracking_run_items_item_idx on revenue_lab.tracking_run_items(source_item_id);
create index tracking_run_items_previous_snapshot_idx on revenue_lab.tracking_run_items(previous_snapshot_id);
create index tracking_run_items_current_snapshot_idx on revenue_lab.tracking_run_items(current_snapshot_id);

create table revenue_lab.tracking_opportunities (
  id uuid primary key default gen_random_uuid(),
  tracking_run_id uuid not null references revenue_lab.tracking_runs(id) on delete cascade,
  source_query_id uuid not null references revenue_lab.source_queries(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  youtube_video_id text not null,
  title text not null,
  channel_id text,
  channel_title text,
  thumbnail_url text,
  published_at timestamptz not null,
  score_version text not null check (score_version = 'youtube-tracking-v1'),
  velocity_mode text not null check (velocity_mode = 'observed_delta'),
  views_velocity numeric(30,6) not null,
  channel_ratio numeric(30,6),
  engagement_rate numeric(30,6) not null,
  freshness numeric(8,4) not null,
  velocity_percentile numeric(8,4) not null,
  channel_ratio_percentile numeric(8,4),
  engagement_percentile numeric(8,4) not null,
  buyer_intent smallint not null check (buyer_intent between 0 and 100),
  commerce_fit smallint not null check (commerce_fit between 0 and 100),
  breakout_score numeric(5,2) not null,
  opportunity_score numeric(5,2) not null,
  breakout_score_raw double precision not null,
  opportunity_score_raw double precision not null,
  percentile_population_size smallint not null check (percentile_population_size > 0),
  score_parameters jsonb not null,
  rank_position smallint not null check (rank_position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tracking_run_id, source_item_id, score_version)
);
create index tracking_opportunities_run_idx on revenue_lab.tracking_opportunities(tracking_run_id);
create index tracking_opportunities_query_idx on revenue_lab.tracking_opportunities(source_query_id, opportunity_score_raw desc);
create index tracking_opportunities_item_idx on revenue_lab.tracking_opportunities(source_item_id);

create or replace function revenue_lab.upsert_tracking_targets(
  p_source_query_id uuid, p_source_item_ids uuid[], p_discovered_at timestamptz, p_collection_run_id uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  insert into revenue_lab.tracking_targets(
    source_query_id, source_item_id, origin_collection_run_id,
    first_discovered_at, last_discovered_at, tracking_until, status
  )
  select p_source_query_id, item_id, p_collection_run_id,
    p_discovered_at, p_discovered_at, p_discovered_at + interval '7 days', 'active'
  from unnest(p_source_item_ids) item_id
  on conflict (source_query_id, source_item_id) do update set
    last_discovered_at = greatest(revenue_lab.tracking_targets.last_discovered_at, excluded.last_discovered_at),
    status = case when revenue_lab.tracking_targets.status = 'retired' then 'retired'
      when revenue_lab.tracking_targets.tracking_until > now() then 'active' else 'expired' end,
    updated_at = now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function revenue_lab.tracking_candidates(
  p_source_id uuid, p_requested_day date, p_captured_at timestamptz
) returns table(
  target_id uuid, source_query_id uuid, source_item_id uuid, youtube_video_id text,
  title text, channel_id text, channel_title text, published_at timestamptz, thumbnail_url text,
  buyer_intent smallint, commerce_fit smallint,
  previous_snapshot_id uuid, previous_captured_at timestamptz, previous_view_count bigint
) language sql stable security definer set search_path = '' as $$
  select t.id, t.source_query_id, i.id, i.external_id, i.title,
    i.metadata->>'channel_id', i.metadata->>'channel_title',
    (i.metadata->>'published_at')::timestamptz, i.metadata->>'thumbnail_url',
    q.buyer_intent, q.commerce_fit,
    previous.id, previous.captured_at, previous.view_count
  from revenue_lab.tracking_targets t
  join revenue_lab.source_queries q on q.id = t.source_query_id
  join revenue_lab.sources s on s.id = q.source_id
  join revenue_lab.source_items i on i.id = t.source_item_id and i.item_type = 'video'
  left join lateral (
    select snap.id, snap.captured_at, snap.view_count
    from revenue_lab.source_item_snapshots snap
    where snap.source_item_id = i.id and snap.captured_at < p_captured_at
      and (snap.capture_kind = 'tracking' or (
        snap.capture_kind = 'discovery' and not exists (
          select 1 from revenue_lab.source_item_snapshots tracked
          where tracked.source_item_id = i.id and tracked.capture_kind = 'tracking'
            and tracked.captured_at < p_captured_at
        )
      ))
    order by snap.captured_at desc limit 1
  ) previous on true
  where s.id = p_source_id and q.enabled and s.enabled
    and t.status = 'active' and t.tracking_until > p_captured_at
    and t.first_discovered_at < (p_requested_day::timestamp at time zone 'Asia/Tokyo')
  order by t.source_query_id, t.first_discovered_at, i.external_id;
$$;

create or replace function revenue_lab.mark_tracking_targets_missing(p_target_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update revenue_lab.tracking_targets set
    missing_count = least(missing_count + 1, 3),
    status = case when missing_count + 1 >= 3 then 'retired' else status end,
    updated_at = now()
  where id = any(p_target_ids);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function revenue_lab.mark_tracking_targets_seen(p_target_ids uuid[], p_seen_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update revenue_lab.tracking_targets set missing_count = 0, last_tracked_at = p_seen_at, updated_at = now()
  where id = any(p_target_ids);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function revenue_lab.enqueue_tracking_jobs(
  p_day date default (now() at time zone 'Asia/Tokyo')::date
) returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
  select s.project_id, 'youtube.track', jsonb_build_object('source_id', s.id, 'requested_day', p_day),
    'youtube.track:' || s.id::text || ':' || p_day::text
  from revenue_lab.sources s join revenue_lab.projects p on p.id = s.project_id
  where s.enabled and p.active and exists (
    select 1 from revenue_lab.source_queries q where q.source_id = s.id and q.enabled
  )
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function revenue_lab.enqueue_daily_youtube_jobs(
  p_day date default (now() at time zone 'Asia/Tokyo')::date
) returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer := 0;
declare tracking_count integer := 0;
begin
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
  select s.project_id, 'youtube.collect', jsonb_build_object('source_query_id', q.id, 'requested_day', p_day),
    'youtube.collect:' || q.id::text || ':' || p_day::text
  from revenue_lab.source_queries q join revenue_lab.sources s on s.id = q.source_id
  join revenue_lab.projects p on p.id = s.project_id
  where q.enabled and s.enabled and p.active
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  tracking_count := revenue_lab.enqueue_tracking_jobs(p_day);
  return inserted_count + tracking_count;
end;
$$;

insert into revenue_lab.tracking_targets(
  source_query_id, source_item_id, origin_collection_run_id,
  first_discovered_at, last_discovered_at, tracking_until, status
)
select cr.source_query_id, cri.source_item_id,
  (array_agg(cr.id order by cr.captured_at))[1],
  min(cr.captured_at), max(cr.captured_at), min(cr.captured_at) + interval '7 days',
  case when min(cr.captured_at) + interval '7 days' > now() then 'active' else 'expired' end
from revenue_lab.collection_run_items cri
join revenue_lab.collection_runs cr on cr.id = cri.collection_run_id and cr.status = 'succeeded'
join revenue_lab.source_items i on i.id = cri.source_item_id and i.item_type = 'video'
group by cr.source_query_id, cri.source_item_id
on conflict (source_query_id, source_item_id) do nothing;

grant all privileges on revenue_lab.tracking_targets, revenue_lab.tracking_runs,
  revenue_lab.tracking_run_items, revenue_lab.tracking_opportunities to service_role;
grant execute on function revenue_lab.upsert_tracking_targets(uuid, uuid[], timestamptz, uuid) to service_role;
grant execute on function revenue_lab.tracking_candidates(uuid, date, timestamptz) to service_role;
grant execute on function revenue_lab.mark_tracking_targets_missing(uuid[]) to service_role;
grant execute on function revenue_lab.mark_tracking_targets_seen(uuid[], timestamptz) to service_role;
grant execute on function revenue_lab.enqueue_tracking_jobs(date) to service_role;

commit;
