begin;

create extension if not exists pgcrypto;
create schema if not exists revenue_lab;
revoke all on schema revenue_lab from public, anon, authenticated;
grant usage on schema revenue_lab to service_role;

create table revenue_lab.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (length(name) between 1 and 120),
  active boolean not null default true,
  timezone text not null default 'Asia/Tokyo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table revenue_lab.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  provider text not null check (provider in ('youtube')),
  name text not null check (length(name) between 1 and 120),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider, name)
);
create index sources_project_id_idx on revenue_lab.sources(project_id);

create table revenue_lab.source_queries (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references revenue_lab.sources(id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  query_text text not null check (length(query_text) between 1 and 200),
  buyer_intent smallint check (buyer_intent between 0 and 100),
  commerce_fit smallint check (commerce_fit between 0 and 100),
  enabled boolean not null default false,
  max_results smallint not null default 25 check (max_results between 1 and 25),
  lookback_days smallint not null default 7 check (lookback_days = 7),
  region_code text not null default 'JP' check (region_code = 'JP'),
  relevance_language text not null default 'ja' check (relevance_language = 'ja'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, query_text)
);
create index source_queries_source_id_idx on revenue_lab.source_queries(source_id);

create or replace function revenue_lab.enforce_enabled_query_limit()
returns trigger language plpgsql set search_path = '' as $$
declare enabled_count integer;
begin
  if new.enabled then
    select count(*) into enabled_count
    from revenue_lab.source_queries q
    where q.source_id = new.source_id and q.enabled and q.id <> new.id;
    if enabled_count >= 3 then
      raise exception 'At most three source queries may be enabled' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger source_queries_enabled_limit
before insert or update of enabled, source_id on revenue_lab.source_queries
for each row execute function revenue_lab.enforce_enabled_query_limit();

create table revenue_lab.source_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references revenue_lab.sources(id) on delete cascade,
  item_type text not null check (item_type in ('video', 'channel')),
  external_id text not null check (length(external_id) between 1 and 128),
  title text,
  canonical_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, item_type, external_id)
);
create index source_items_source_id_idx on revenue_lab.source_items(source_id);

create table revenue_lab.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  job_type text not null check (job_type in ('youtube.collect')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  priority smallint not null default 0,
  run_after timestamptz not null default now(),
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  lease_expires_at timestamptz,
  worker_id text,
  idempotency_key text not null unique,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index jobs_project_id_idx on revenue_lab.jobs(project_id);
create index jobs_claim_idx on revenue_lab.jobs(status, run_after, priority desc, created_at);

create table revenue_lab.collection_runs (
  id uuid primary key default gen_random_uuid(),
  source_query_id uuid not null references revenue_lab.source_queries(id) on delete cascade,
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  captured_at timestamptz not null,
  requested_count smallint not null default 0,
  received_count smallint not null default 0,
  scored_count smallint not null default 0,
  excluded_reason text,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collection_runs_source_query_id_idx on revenue_lab.collection_runs(source_query_id, captured_at desc);
create index collection_runs_job_id_idx on revenue_lab.collection_runs(job_id);

create table revenue_lab.source_item_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  captured_at timestamptz not null,
  view_count bigint check (view_count >= 0),
  like_count bigint check (like_count >= 0),
  comment_count bigint check (comment_count >= 0),
  subscriber_count bigint check (subscriber_count >= 0),
  hidden_subscriber_count boolean not null default false,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_item_id, captured_at)
);
create index source_item_snapshots_source_item_id_idx on revenue_lab.source_item_snapshots(source_item_id, captured_at desc);

create table revenue_lab.collection_run_items (
  id uuid primary key default gen_random_uuid(),
  collection_run_id uuid not null references revenue_lab.collection_runs(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  snapshot_id uuid not null references revenue_lab.source_item_snapshots(id) on delete cascade,
  search_position smallint not null check (search_position between 1 and 25),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_run_id, source_item_id)
);
create index collection_run_items_run_id_idx on revenue_lab.collection_run_items(collection_run_id);
create index collection_run_items_item_id_idx on revenue_lab.collection_run_items(source_item_id);
create index collection_run_items_snapshot_id_idx on revenue_lab.collection_run_items(snapshot_id);

create table revenue_lab.opportunities (
  id uuid primary key default gen_random_uuid(),
  collection_run_id uuid not null references revenue_lab.collection_runs(id) on delete cascade,
  source_query_id uuid not null references revenue_lab.source_queries(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  youtube_video_id text not null,
  title text not null,
  channel_id text,
  channel_title text,
  thumbnail_url text,
  published_at timestamptz not null,
  score_version text not null check (score_version = 'youtube-v1'),
  velocity_mode text not null check (velocity_mode in ('estimated_lifetime', 'observed_delta')),
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
  unique (collection_run_id, source_item_id, score_version)
);
create index opportunities_collection_run_id_idx on revenue_lab.opportunities(collection_run_id);
create index opportunities_source_query_id_idx on revenue_lab.opportunities(source_query_id, opportunity_score_raw desc);
create index opportunities_source_item_id_idx on revenue_lab.opportunities(source_item_id);

create or replace function revenue_lab.claim_next_job(p_worker_id text, p_lease_seconds integer default 300)
returns setof revenue_lab.jobs language plpgsql security definer set search_path = '' as $$
declare claimed_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then raise exception 'worker id is required'; end if;
  if p_lease_seconds < 60 or p_lease_seconds > 3600 then raise exception 'lease seconds out of range'; end if;
  select id into claimed_id from revenue_lab.jobs
  where attempts < max_attempts and run_after <= now()
    and (status = 'pending' or (status = 'running' and lease_expires_at < now()))
  order by priority desc, created_at asc for update skip locked limit 1;
  if claimed_id is null then return; end if;
  return query update revenue_lab.jobs set status = 'running', attempts = attempts + 1,
    worker_id = p_worker_id, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now(), error_code = null, error_message = null where id = claimed_id returning *;
end;
$$;

create or replace function revenue_lab.finish_job(p_job_id uuid, p_worker_id text, p_succeeded boolean, p_error_code text default null, p_error_message text default null)
returns revenue_lab.jobs language plpgsql security definer set search_path = '' as $$
declare result revenue_lab.jobs;
begin
  update revenue_lab.jobs set
    status = case when p_succeeded then 'succeeded' else 'failed' end,
    error_code = case when p_succeeded then null else left(p_error_code, 80) end,
    error_message = case when p_succeeded then null else left(p_error_message, 500) end,
    lease_expires_at = null, completed_at = now(), updated_at = now()
  where id = p_job_id and status = 'running' and worker_id = p_worker_id returning * into result;
  if result.id is null then raise exception 'job lease is not owned by this worker'; end if;
  return result;
end;
$$;

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

create or replace function revenue_lab.dashboard_snapshot(p_limit integer default 3)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'queries', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at) from (select id, source_id, label, query_text, buyer_intent, commerce_fit, enabled, max_results, lookback_days, region_code, relevance_language, updated_at, created_at from revenue_lab.source_queries order by created_at limit 3) q), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(to_jsonb(o) order by o.opportunity_score_raw desc, o.breakout_score_raw desc, o.published_at desc, o.youtube_video_id asc) from (select id, source_query_id, youtube_video_id, title, channel_id, channel_title, thumbnail_url, published_at, score_version, velocity_mode, views_velocity, channel_ratio, engagement_rate, freshness, velocity_percentile, channel_ratio_percentile, engagement_percentile, buyer_intent, commerce_fit, breakout_score, opportunity_score, percentile_population_size, created_at, opportunity_score_raw, breakout_score_raw from revenue_lab.opportunities where collection_run_id in (select distinct on (source_query_id) id from revenue_lab.collection_runs order by source_query_id, captured_at desc) order by opportunity_score_raw desc, breakout_score_raw desc, published_at desc, youtube_video_id asc limit greatest(1, least(p_limit, 3))) o), '[]'::jsonb),
    'latest_job', (select to_jsonb(j) from (select id, job_type, status, attempts, error_code, error_message, created_at, updated_at, completed_at from revenue_lab.jobs order by created_at desc limit 1) j)
  );
$$;

grant all privileges on all tables in schema revenue_lab to service_role;
grant usage, select on all sequences in schema revenue_lab to service_role;
grant execute on all functions in schema revenue_lab to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'revenue-lab-daily-youtube') then
      perform cron.schedule('revenue-lab-daily-youtube', '15 20 * * *', 'select revenue_lab.enqueue_daily_youtube_jobs();');
    end if;
  end if;
end $$;

commit;
