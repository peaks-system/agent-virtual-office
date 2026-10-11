begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description', 'creative.production.plan',
    'video.generate.scene'));

create table revenue_lab.video_generation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  creative_production_plan_id uuid not null references revenue_lab.creative_production_plans(id) on delete restrict,
  provider text not null,
  provider_version text not null,
  requested_model text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  safe_error_code text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, idempotency_key)
);
create index video_generation_runs_campaign_idx on revenue_lab.video_generation_runs(campaign_id, created_at desc);
create index video_generation_runs_iteration_idx on revenue_lab.video_generation_runs(campaign_iteration_id, created_at desc);
create index video_generation_runs_plan_idx on revenue_lab.video_generation_runs(creative_production_plan_id, created_at desc);

create table revenue_lab.video_generation_scenes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references revenue_lab.video_generation_runs(id) on delete restrict,
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  creative_production_plan_id uuid not null references revenue_lab.creative_production_plans(id) on delete restrict,
  creative_scene_number smallint not null check (creative_scene_number > 0),
  attempt_number smallint not null check (attempt_number > 0),
  provider text not null,
  provider_version text not null,
  requested_model text not null,
  provider_task_id text,
  provider_task_status text,
  prompt_snapshot text not null,
  prompt_fingerprint text not null check (prompt_fingerprint ~ '^[0-9a-f]{64}$'),
  input_asset_id uuid references revenue_lab.product_assets(id) on delete restrict,
  duration_seconds smallint not null check (duration_seconds in (5, 10)),
  aspect_ratio text not null check (aspect_ratio = '9:16'),
  resolution text not null check (resolution in ('480p', '720p', '1080p')),
  audio_enabled boolean not null default false check (audio_enabled = false),
  status text not null default 'queued' check (status in ('queued', 'submitting', 'polling', 'succeeded', 'failed')),
  provider_cost_amount numeric(14, 6) check (provider_cost_amount is null or provider_cost_amount >= 0),
  provider_cost_currency text check (provider_cost_currency is null or provider_cost_currency ~ '^[A-Z]{3}$'),
  cost_provenance text not null default 'unavailable' check (cost_provenance in ('actual', 'estimated', 'unavailable')),
  output_url text check (output_url is null or output_url ~ '^https://'),
  safe_error_code text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (creative_production_plan_id, creative_scene_number, attempt_number),
  constraint video_generation_scenes_cost_consistency check (
    (cost_provenance = 'unavailable' and provider_cost_amount is null and provider_cost_currency is null)
    or (cost_provenance in ('actual', 'estimated') and provider_cost_amount is not null and provider_cost_currency is not null)
  )
);
create index video_generation_scenes_run_idx on revenue_lab.video_generation_scenes(run_id);
create index video_generation_scenes_project_idx on revenue_lab.video_generation_scenes(project_id, created_at desc);
create index video_generation_scenes_campaign_idx on revenue_lab.video_generation_scenes(campaign_id, created_at desc);
create index video_generation_scenes_iteration_idx on revenue_lab.video_generation_scenes(campaign_iteration_id, created_at desc);
create index video_generation_scenes_plan_idx on revenue_lab.video_generation_scenes(creative_production_plan_id, creative_scene_number, attempt_number desc);
create index video_generation_scenes_asset_idx on revenue_lab.video_generation_scenes(input_asset_id) where input_asset_id is not null;
create unique index video_generation_scenes_one_active_idx
  on revenue_lab.video_generation_scenes(creative_production_plan_id, creative_scene_number, provider, requested_model, prompt_fingerprint)
  where status in ('queued', 'submitting', 'polling');

create function revenue_lab.enqueue_video_generation_scene(
  p_creative_production_plan_id uuid,
  p_scene_number smallint,
  p_provider text,
  p_provider_version text,
  p_requested_model text,
  p_prompt_fingerprint text,
  p_request_fingerprint text,
  p_duration_seconds smallint,
  p_resolution text,
  p_idempotency_key uuid,
  p_regenerate boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  plan_row revenue_lab.creative_production_plans;
  request_row revenue_lab.creative_production_requests;
  scene_json jsonb;
  existing_run revenue_lab.video_generation_runs;
  existing_scene revenue_lab.video_generation_scenes;
  run_row revenue_lab.video_generation_runs;
  scene_row revenue_lab.video_generation_scenes;
  job_row revenue_lab.jobs;
  next_attempt smallint;
begin
  select * into plan_row from revenue_lab.creative_production_plans
    where id = p_creative_production_plan_id for update;
  if plan_row.id is null then raise exception 'Creative Production plan was not found' using errcode = 'P0002'; end if;
  select * into request_row from revenue_lab.creative_production_requests where id = plan_row.production_request_id;
  if request_row.id is null then raise exception 'Creative Production request was not found' using errcode = 'P0002'; end if;
  select value into scene_json from jsonb_array_elements(plan_row.output_json->'scenes') value
    where (value->>'scene_number')::smallint = p_scene_number limit 1;
  if scene_json is null then raise exception 'Creative scene was not found' using errcode = 'P0002'; end if;
  if scene_json->>'visual_source_type' <> 'ai_generated_scene' then
    raise exception 'Only AI-generated scenes may use a video provider' using errcode = '22023';
  end if;
  if nullif(trim(scene_json->>'ai_generation_prompt'), '') is null then
    raise exception 'AI-generated scene has no prompt' using errcode = '22023';
  end if;

  select * into existing_run from revenue_lab.video_generation_runs
    where project_id = plan_row.project_id and idempotency_key = p_idempotency_key;
  if existing_run.id is not null then
    select * into existing_scene from revenue_lab.video_generation_scenes where run_id = existing_run.id limit 1;
    if existing_run.request_fingerprint <> p_request_fingerprint
      or existing_scene.creative_production_plan_id <> p_creative_production_plan_id
      or existing_scene.creative_scene_number <> p_scene_number then
      raise exception 'Idempotency key was reused with different video generation input' using errcode = '22023';
    end if;
    return jsonb_build_object('runId', existing_run.id, 'sceneGenerationId', existing_scene.id,
      'attemptNumber', existing_scene.attempt_number, 'status', existing_scene.status,
      'created', false, 'idempotentReplay', true);
  end if;

  select * into existing_scene from revenue_lab.video_generation_scenes
    where creative_production_plan_id = p_creative_production_plan_id
      and creative_scene_number = p_scene_number and provider = p_provider
      and requested_model = p_requested_model and prompt_fingerprint = p_prompt_fingerprint
      and (status in ('queued', 'submitting', 'polling') or not p_regenerate)
    order by attempt_number desc limit 1;
  if existing_scene.id is not null then
    return jsonb_build_object('runId', existing_scene.run_id, 'sceneGenerationId', existing_scene.id,
      'attemptNumber', existing_scene.attempt_number, 'status', existing_scene.status,
      'created', false, 'idempotentReplay', false);
  end if;

  select (coalesce(max(attempt_number), 0) + 1)::smallint into next_attempt
    from revenue_lab.video_generation_scenes
    where creative_production_plan_id = p_creative_production_plan_id and creative_scene_number = p_scene_number;
  insert into revenue_lab.video_generation_runs(
    project_id, campaign_id, campaign_iteration_id, creative_production_plan_id,
    provider, provider_version, requested_model, idempotency_key, request_fingerprint
  ) values (
    plan_row.project_id, plan_row.campaign_id, plan_row.campaign_iteration_id, plan_row.id,
    p_provider, p_provider_version, p_requested_model, p_idempotency_key, p_request_fingerprint
  ) returning * into run_row;
  insert into revenue_lab.video_generation_scenes(
    run_id, project_id, campaign_id, campaign_iteration_id, creative_production_plan_id,
    creative_scene_number, attempt_number, provider, provider_version, requested_model,
    prompt_snapshot, prompt_fingerprint, input_asset_id, duration_seconds, aspect_ratio, resolution
  ) values (
    run_row.id, plan_row.project_id, plan_row.campaign_id, plan_row.campaign_iteration_id, plan_row.id,
    p_scene_number, next_attempt, p_provider, p_provider_version, p_requested_model,
    scene_json->>'ai_generation_prompt', p_prompt_fingerprint, null, p_duration_seconds, '9:16', p_resolution
  ) returning * into scene_row;
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
    values (plan_row.project_id, 'video.generate.scene',
      jsonb_build_object('video_generation_scene_id', scene_row.id),
      'video.generate.scene:' || scene_row.id::text, 3)
    returning * into job_row;
  return jsonb_build_object('runId', run_row.id, 'sceneGenerationId', scene_row.id,
    'jobId', job_row.id, 'attemptNumber', scene_row.attempt_number, 'status', scene_row.status,
    'created', true, 'idempotentReplay', false);
end;
$$;

revoke all privileges on revenue_lab.video_generation_runs, revenue_lab.video_generation_scenes
  from public, anon, authenticated;
grant all privileges on revenue_lab.video_generation_runs, revenue_lab.video_generation_scenes to service_role;
revoke delete on revenue_lab.video_generation_runs, revenue_lab.video_generation_scenes from service_role;
revoke execute on function revenue_lab.enqueue_video_generation_scene(uuid, smallint, text, text, text, text, text, smallint, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_video_generation_scene(uuid, smallint, text, text, text, text, text, smallint, text, uuid, boolean)
  to service_role;

commit;
