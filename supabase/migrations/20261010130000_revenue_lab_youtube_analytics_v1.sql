begin;

create table revenue_lab.youtube_analytics_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  provider text not null default 'youtube-analytics' check (provider = 'youtube-analytics'),
  channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{20,30}$'),
  channel_title text not null check (char_length(channel_title) between 1 and 200),
  scopes text[] not null check (cardinality(scopes) > 0),
  credential_ref text not null check (credential_ref ~ '^local-dpapi:[0-9a-f-]{36}$'),
  connection_status text not null default 'connected'
    check (connection_status in ('connected', 'reauth_required', 'revoked', 'error')),
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  reauth_required_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id),
  unique (credential_ref)
);

create table revenue_lab.youtube_analytics_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  connection_id uuid not null references revenue_lab.youtube_analytics_connections(id) on delete restrict,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  campaign_publication_id uuid not null references revenue_lab.campaign_publications(id) on delete restrict,
  requested_start_date date not null,
  requested_end_date date not null,
  requested_metrics text[] not null check (cardinality(requested_metrics) > 0),
  query_version text not null check (query_version = 'youtube-analytics-v1'),
  status text not null default 'running' check (status in ('running', 'succeeded', 'no_data', 'failed')),
  captured_at timestamptz not null default now(),
  data_through_date date,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (requested_end_date >= requested_start_date),
  check (data_through_date is null or data_through_date between requested_start_date and requested_end_date)
);
create index youtube_analytics_runs_project_idx on revenue_lab.youtube_analytics_runs(project_id, captured_at desc);
create index youtube_analytics_runs_connection_idx on revenue_lab.youtube_analytics_runs(connection_id, captured_at desc);
create index youtube_analytics_runs_campaign_idx on revenue_lab.youtube_analytics_runs(campaign_id, captured_at desc);
create index youtube_analytics_runs_iteration_idx on revenue_lab.youtube_analytics_runs(campaign_iteration_id, captured_at desc);
create index youtube_analytics_runs_publication_idx on revenue_lab.youtube_analytics_runs(campaign_publication_id, captured_at desc);

create table revenue_lab.youtube_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references revenue_lab.youtube_analytics_runs(id) on delete cascade,
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  connection_id uuid not null references revenue_lab.youtube_analytics_connections(id) on delete restrict,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  campaign_publication_id uuid not null references revenue_lab.campaign_publications(id) on delete restrict,
  youtube_video_id text not null check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,32}$'),
  requested_start_date date not null,
  requested_end_date date not null,
  captured_at timestamptz not null,
  data_through_date date,
  query_version text not null check (query_version = 'youtube-analytics-v1'),
  views bigint check (views is null or views >= 0),
  estimated_minutes_watched numeric check (estimated_minutes_watched is null or estimated_minutes_watched >= 0),
  average_view_duration numeric check (average_view_duration is null or average_view_duration >= 0),
  average_view_percentage numeric check (average_view_percentage is null or average_view_percentage >= 0),
  subscribers_gained bigint check (subscribers_gained is null or subscribers_gained >= 0),
  subscribers_lost bigint check (subscribers_lost is null or subscribers_lost >= 0),
  likes bigint check (likes is null or likes >= 0),
  comments bigint check (comments is null or comments >= 0),
  shares bigint check (shares is null or shares >= 0),
  raw_metrics jsonb not null,
  created_at timestamptz not null default now(),
  check (requested_end_date >= requested_start_date),
  check (data_through_date is null or data_through_date between requested_start_date and requested_end_date)
);
create index youtube_performance_snapshots_project_idx on revenue_lab.youtube_performance_snapshots(project_id, captured_at desc);
create index youtube_performance_snapshots_campaign_idx on revenue_lab.youtube_performance_snapshots(campaign_id, captured_at desc);
create index youtube_performance_snapshots_iteration_idx on revenue_lab.youtube_performance_snapshots(campaign_iteration_id, captured_at desc);
create index youtube_performance_snapshots_publication_idx on revenue_lab.youtube_performance_snapshots(campaign_publication_id, captured_at desc);

create function revenue_lab.upsert_youtube_analytics_connection(
  p_project_id uuid,
  p_channel_id text,
  p_channel_title text,
  p_scopes text[],
  p_credential_ref text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare connection_row revenue_lab.youtube_analytics_connections;
begin
  if not exists (select 1 from revenue_lab.projects where id = p_project_id) then
    raise exception 'Project was not found' using errcode = 'P0002';
  end if;
  insert into revenue_lab.youtube_analytics_connections(
    project_id, channel_id, channel_title, scopes, credential_ref,
    connection_status, connected_at, last_verified_at, reauth_required_at, safe_error_code
  ) values (
    p_project_id, p_channel_id, p_channel_title, p_scopes, p_credential_ref,
    'connected', now(), now(), null, null
  ) on conflict (project_id) do update set
    channel_id = excluded.channel_id,
    channel_title = excluded.channel_title,
    scopes = excluded.scopes,
    credential_ref = excluded.credential_ref,
    connection_status = 'connected',
    connected_at = now(),
    last_verified_at = now(),
    reauth_required_at = null,
    safe_error_code = null,
    updated_at = now()
  returning * into connection_row;
  return jsonb_build_object(
    'id', connection_row.id, 'projectId', connection_row.project_id,
    'channelId', connection_row.channel_id, 'channelTitle', connection_row.channel_title,
    'scopes', connection_row.scopes, 'credentialRef', connection_row.credential_ref,
    'connectionStatus', connection_row.connection_status,
    'connectedAt', connection_row.connected_at, 'lastVerifiedAt', connection_row.last_verified_at
  );
end;
$$;

create function revenue_lab.start_youtube_analytics_run(
  p_campaign_publication_id uuid,
  p_connection_id uuid,
  p_start_date date,
  p_end_date date,
  p_query_version text,
  p_requested_metrics text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare publication_row revenue_lab.campaign_publications;
declare iteration_row revenue_lab.campaign_iterations;
declare campaign_row revenue_lab.campaigns;
declare connection_row revenue_lab.youtube_analytics_connections;
declare run_row revenue_lab.youtube_analytics_runs;
begin
  select * into publication_row from revenue_lab.campaign_publications where id = p_campaign_publication_id;
  if publication_row.id is null then raise exception 'Publication was not found' using errcode = 'P0002'; end if;
  select * into iteration_row from revenue_lab.campaign_iterations where id = publication_row.campaign_iteration_id;
  select * into campaign_row from revenue_lab.campaigns where id = iteration_row.campaign_id;
  select * into connection_row from revenue_lab.youtube_analytics_connections where id = p_connection_id;
  if connection_row.id is null or connection_row.project_id <> campaign_row.project_id then
    raise exception 'Analytics connection does not belong to the Campaign project' using errcode = '22023';
  end if;
  if connection_row.connection_status <> 'connected' then
    raise exception 'Analytics connection requires authorization' using errcode = '55000';
  end if;
  insert into revenue_lab.youtube_analytics_runs(
    project_id, connection_id, campaign_id, campaign_iteration_id, campaign_publication_id,
    requested_start_date, requested_end_date, requested_metrics, query_version
  ) values (
    campaign_row.project_id, connection_row.id, campaign_row.id, iteration_row.id, publication_row.id,
    p_start_date, p_end_date, p_requested_metrics, p_query_version
  ) returning * into run_row;
  return jsonb_build_object(
    'runId', run_row.id, 'projectId', run_row.project_id, 'connectionId', connection_row.id,
    'credentialRef', connection_row.credential_ref, 'channelId', connection_row.channel_id,
    'campaignId', campaign_row.id, 'iterationId', iteration_row.id,
    'publicationId', publication_row.id, 'youtubeVideoId', publication_row.youtube_video_id,
    'capturedAt', run_row.captured_at
  );
end;
$$;

create function revenue_lab.finish_youtube_analytics_run(
  p_run_id uuid,
  p_snapshot jsonb,
  p_no_data boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare run_row revenue_lab.youtube_analytics_runs;
declare publication_row revenue_lab.campaign_publications;
declare snapshot_row revenue_lab.youtube_performance_snapshots;
begin
  select * into run_row from revenue_lab.youtube_analytics_runs where id = p_run_id for update;
  if run_row.id is null then raise exception 'Analytics run was not found' using errcode = 'P0002'; end if;
  if run_row.status <> 'running' then raise exception 'Analytics run is already complete' using errcode = '55000'; end if;
  select * into publication_row from revenue_lab.campaign_publications where id = run_row.campaign_publication_id;
  insert into revenue_lab.youtube_performance_snapshots(
    run_id, project_id, connection_id, campaign_id, campaign_iteration_id, campaign_publication_id,
    youtube_video_id, requested_start_date, requested_end_date, captured_at, data_through_date,
    query_version, views, estimated_minutes_watched, average_view_duration,
    average_view_percentage, subscribers_gained, subscribers_lost, likes, comments, shares, raw_metrics
  ) values (
    run_row.id, run_row.project_id, run_row.connection_id, run_row.campaign_id,
    run_row.campaign_iteration_id, run_row.campaign_publication_id, publication_row.youtube_video_id,
    run_row.requested_start_date, run_row.requested_end_date, run_row.captured_at,
    nullif(p_snapshot->>'data_through_date', '')::date, run_row.query_version,
    nullif(p_snapshot->>'views', '')::bigint,
    nullif(p_snapshot->>'estimated_minutes_watched', '')::numeric,
    nullif(p_snapshot->>'average_view_duration', '')::numeric,
    nullif(p_snapshot->>'average_view_percentage', '')::numeric,
    nullif(p_snapshot->>'subscribers_gained', '')::bigint,
    nullif(p_snapshot->>'subscribers_lost', '')::bigint,
    nullif(p_snapshot->>'likes', '')::bigint,
    nullif(p_snapshot->>'comments', '')::bigint,
    nullif(p_snapshot->>'shares', '')::bigint,
    coalesce(p_snapshot->'raw_metrics', '{}'::jsonb)
  ) returning * into snapshot_row;
  update revenue_lab.youtube_analytics_runs set
    status = case when p_no_data then 'no_data' else 'succeeded' end,
    data_through_date = snapshot_row.data_through_date,
    completed_at = now()
  where id = run_row.id;
  update revenue_lab.youtube_analytics_connections
  set connection_status = 'connected', last_verified_at = now(),
      reauth_required_at = null, safe_error_code = null, updated_at = now()
  where id = run_row.connection_id;
  return jsonb_build_object(
    'id', snapshot_row.id, 'runId', snapshot_row.run_id,
    'publicationId', snapshot_row.campaign_publication_id,
    'capturedAt', snapshot_row.captured_at,
    'dataThroughDate', snapshot_row.data_through_date,
    'queryVersion', snapshot_row.query_version,
    'views', snapshot_row.views,
    'estimatedMinutesWatched', snapshot_row.estimated_minutes_watched,
    'averageViewDuration', snapshot_row.average_view_duration,
    'averageViewPercentage', snapshot_row.average_view_percentage,
    'subscribersGained', snapshot_row.subscribers_gained,
    'subscribersLost', snapshot_row.subscribers_lost,
    'likes', snapshot_row.likes, 'comments', snapshot_row.comments, 'shares', snapshot_row.shares,
    'status', case when p_no_data then 'no_data' else 'succeeded' end
  );
end;
$$;

create function revenue_lab.fail_youtube_analytics_run(
  p_run_id uuid,
  p_error_code text,
  p_reauth_required boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare connection_uuid uuid;
begin
  update revenue_lab.youtube_analytics_runs
  set status = 'failed', error_code = left(p_error_code, 80), completed_at = now()
  where id = p_run_id and status = 'running'
  returning connection_id into connection_uuid;
  if p_reauth_required and connection_uuid is not null then
    update revenue_lab.youtube_analytics_connections
    set connection_status = 'reauth_required', reauth_required_at = now(),
        safe_error_code = left(p_error_code, 80), updated_at = now()
    where id = connection_uuid;
  end if;
end;
$$;

revoke all privileges on revenue_lab.youtube_analytics_connections,
  revenue_lab.youtube_analytics_runs, revenue_lab.youtube_performance_snapshots
  from public, anon, authenticated;
grant all privileges on revenue_lab.youtube_analytics_connections,
  revenue_lab.youtube_analytics_runs, revenue_lab.youtube_performance_snapshots
  to service_role;

revoke execute on function revenue_lab.upsert_youtube_analytics_connection(uuid, text, text, text[], text)
  from public, anon, authenticated;
grant execute on function revenue_lab.upsert_youtube_analytics_connection(uuid, text, text, text[], text)
  to service_role;
revoke execute on function revenue_lab.start_youtube_analytics_run(uuid, uuid, date, date, text, text[])
  from public, anon, authenticated;
grant execute on function revenue_lab.start_youtube_analytics_run(uuid, uuid, date, date, text, text[])
  to service_role;
revoke execute on function revenue_lab.finish_youtube_analytics_run(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function revenue_lab.finish_youtube_analytics_run(uuid, jsonb, boolean)
  to service_role;
revoke execute on function revenue_lab.fail_youtube_analytics_run(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function revenue_lab.fail_youtube_analytics_run(uuid, text, boolean)
  to service_role;

commit;
