begin;

create table revenue_lab.product_asset_revisions (
  id uuid primary key default gen_random_uuid(),
  product_asset_id uuid not null references revenue_lab.product_assets(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  source_url_snapshot text not null check (source_url_snapshot ~ '^https://'),
  storage_provider text not null check (char_length(storage_provider) between 1 and 80),
  storage_bucket text not null check (char_length(storage_bucket) between 3 and 63),
  immutable_object_key text not null check (immutable_object_key ~ '^product-assets/[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|webp)$'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 12582912),
  pixel_width integer not null check (pixel_width between 1 and 12000),
  pixel_height integer not null check (pixel_height between 1 and 12000),
  permission_snapshot text not null check (permission_snapshot in ('owned', 'licensed', 'authorized_reference', 'unknown')),
  i2v_allowed_snapshot boolean not null,
  parent_revision_id uuid references revenue_lab.product_asset_revisions(id) on delete restrict,
  derivation_type text not null check (derivation_type in ('source_capture', 'pad_9_16')),
  derivation_spec jsonb not null default '{}'::jsonb check (jsonb_typeof(derivation_spec) = 'object'),
  transformation_fingerprint text not null check (transformation_fingerprint ~ '^[0-9a-f]{64}$'),
  availability_status text not null default 'available' check (availability_status in ('available', 'unavailable')),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (product_asset_id, revision_number),
  unique (product_asset_id, content_sha256, transformation_fingerprint),
  constraint product_asset_revisions_permission_check check (not i2v_allowed_snapshot or permission_snapshot = 'owned'),
  constraint product_asset_revisions_parent_check check (
    (derivation_type = 'source_capture' and parent_revision_id is null)
    or (derivation_type = 'pad_9_16' and parent_revision_id is not null)
  )
);
create index product_asset_revisions_asset_idx on revenue_lab.product_asset_revisions(product_asset_id, revision_number desc);
create index product_asset_revisions_parent_idx on revenue_lab.product_asset_revisions(parent_revision_id) where parent_revision_id is not null;

alter table revenue_lab.video_generation_runs drop constraint if exists video_generation_runs_status_check;
alter table revenue_lab.video_generation_runs add constraint video_generation_runs_status_check
  check (status in ('queued', 'running', 'submission_uncertain', 'succeeded', 'failed'));

alter table revenue_lab.video_generation_scenes
  add column generation_mode text not null default 'text_to_video',
  add column input_asset_revision_id uuid references revenue_lab.product_asset_revisions(id) on delete restrict,
  add column input_asset_snapshot jsonb,
  add column negative_prompt_snapshot text,
  add column prompt_builder_version text,
  add column generation_input_fingerprint text check (generation_input_fingerprint is null or generation_input_fingerprint ~ '^[0-9a-f]{64}$'),
  add column provider_adapter_version text,
  add column submission_uncertain boolean not null default false;

alter table revenue_lab.video_generation_scenes drop constraint if exists video_generation_scenes_status_check;
alter table revenue_lab.video_generation_scenes add constraint video_generation_scenes_status_check
  check (status in ('queued', 'submitting', 'polling', 'submission_uncertain', 'succeeded', 'failed'));
alter table revenue_lab.video_generation_scenes add constraint video_generation_scenes_generation_mode_check
  check (generation_mode in ('text_to_video', 'image_to_video'));
alter table revenue_lab.video_generation_scenes add constraint video_generation_scenes_i2v_shape_check check (
  (generation_mode = 'text_to_video' and input_asset_revision_id is null and submission_uncertain = false)
  or
  (generation_mode = 'image_to_video' and input_asset_id is not null and input_asset_revision_id is not null
    and input_asset_snapshot is not null and jsonb_typeof(input_asset_snapshot) = 'object'
    and negative_prompt_snapshot is not null and prompt_builder_version is not null
    and generation_input_fingerprint is not null and provider_adapter_version is not null)
);
create index video_generation_scenes_asset_revision_idx on revenue_lab.video_generation_scenes(input_asset_revision_id)
  where input_asset_revision_id is not null;

drop index revenue_lab.video_generation_scenes_one_active_idx;
create unique index video_generation_scenes_one_active_idx
  on revenue_lab.video_generation_scenes(
    creative_production_plan_id, creative_scene_number, provider, requested_model,
    coalesce(generation_input_fingerprint, prompt_fingerprint)
  ) where status in ('queued', 'submitting', 'polling', 'submission_uncertain');

create function revenue_lab.register_product_asset_revision(
  p_product_asset_id uuid,
  p_source_url_snapshot text,
  p_storage_provider text,
  p_storage_bucket text,
  p_immutable_object_key text,
  p_content_sha256 text,
  p_content_type text,
  p_byte_size bigint,
  p_pixel_width integer,
  p_pixel_height integer,
  p_i2v_allowed boolean,
  p_parent_revision_id uuid,
  p_derivation_type text,
  p_derivation_spec jsonb,
  p_transformation_fingerprint text
) returns revenue_lab.product_asset_revisions language plpgsql security definer set search_path = '' as $$
declare
  asset_row revenue_lab.product_assets;
  parent_row revenue_lab.product_asset_revisions;
  existing_row revenue_lab.product_asset_revisions;
  revision_row revenue_lab.product_asset_revisions;
  next_revision integer;
begin
  select * into asset_row from revenue_lab.product_assets where id = p_product_asset_id for update;
  if asset_row.id is null then raise exception 'Product Asset was not found' using errcode = 'P0002'; end if;
  if p_i2v_allowed and asset_row.usage_permission <> 'owned' then
    raise exception 'Phase v1 I2V requires owned permission' using errcode = '22023';
  end if;
  if p_derivation_type = 'source_capture' and p_parent_revision_id is not null then
    raise exception 'Source revision cannot have a parent' using errcode = '22023';
  end if;
  if p_derivation_type = 'pad_9_16' then
    select * into parent_row from revenue_lab.product_asset_revisions where id = p_parent_revision_id;
    if parent_row.id is null or parent_row.product_asset_id <> p_product_asset_id then
      raise exception 'Derived revision parent is invalid' using errcode = '22023';
    end if;
    if p_pixel_width * 16 <> p_pixel_height * 9 then
      raise exception 'Padded revision must be exactly 9:16' using errcode = '22023';
    end if;
  end if;
  select * into existing_row from revenue_lab.product_asset_revisions
    where product_asset_id = p_product_asset_id and content_sha256 = p_content_sha256
      and transformation_fingerprint = p_transformation_fingerprint;
  if existing_row.id is not null then return existing_row; end if;
  select coalesce(max(revision_number), 0) + 1 into next_revision
    from revenue_lab.product_asset_revisions where product_asset_id = p_product_asset_id;
  insert into revenue_lab.product_asset_revisions(
    product_asset_id, revision_number, source_url_snapshot, storage_provider, storage_bucket,
    immutable_object_key, content_sha256, content_type, byte_size, pixel_width, pixel_height,
    permission_snapshot, i2v_allowed_snapshot, parent_revision_id, derivation_type,
    derivation_spec, transformation_fingerprint
  ) values (
    p_product_asset_id, next_revision, p_source_url_snapshot, p_storage_provider, p_storage_bucket,
    p_immutable_object_key, p_content_sha256, p_content_type, p_byte_size, p_pixel_width, p_pixel_height,
    asset_row.usage_permission, p_i2v_allowed, p_parent_revision_id, p_derivation_type,
    coalesce(p_derivation_spec, '{}'::jsonb), p_transformation_fingerprint
  ) returning * into revision_row;
  return revision_row;
end;
$$;

create function revenue_lab.enqueue_image_video_generation_scene(
  p_creative_production_plan_id uuid,
  p_scene_number smallint,
  p_provider text,
  p_provider_version text,
  p_provider_adapter_version text,
  p_requested_model text,
  p_asset_revision_id uuid,
  p_positive_prompt text,
  p_negative_prompt text,
  p_prompt_builder_version text,
  p_prompt_fingerprint text,
  p_generation_input_fingerprint text,
  p_request_fingerprint text,
  p_duration_seconds smallint,
  p_resolution text,
  p_idempotency_key uuid,
  p_regenerate boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  plan_row revenue_lab.creative_production_plans;
  scene_json jsonb;
  revision_row revenue_lab.product_asset_revisions;
  existing_run revenue_lab.video_generation_runs;
  existing_scene revenue_lab.video_generation_scenes;
  run_row revenue_lab.video_generation_runs;
  scene_row revenue_lab.video_generation_scenes;
  job_row revenue_lab.jobs;
  next_attempt smallint;
begin
  select * into plan_row from revenue_lab.creative_production_plans where id = p_creative_production_plan_id for update;
  if plan_row.id is null then raise exception 'Creative Production plan was not found' using errcode = 'P0002'; end if;
  select value into scene_json from jsonb_array_elements(plan_row.output_json->'scenes') value
    where (value->>'scene_number')::smallint = p_scene_number limit 1;
  if scene_json is null then raise exception 'Creative scene was not found' using errcode = 'P0002'; end if;
  if plan_row.schema_version <> 'creative-production-plan-v2'
    or scene_json->>'rendering_strategy' <> 'image_motion_scene'
    or scene_json->>'visual_source_type' <> 'real_product_asset'
    or coalesce((scene_json->>'preserve_product_identity')::boolean, false) is not true then
    raise exception 'Only identity-preserving v2 image-motion scenes may use I2V' using errcode = '22023';
  end if;
  select * into revision_row from revenue_lab.product_asset_revisions where id = p_asset_revision_id;
  if revision_row.id is null or revision_row.product_asset_id::text <> scene_json->>'product_asset_id'
    or revision_row.permission_snapshot <> 'owned' or revision_row.i2v_allowed_snapshot is not true
    or revision_row.availability_status <> 'available' then
    raise exception 'Product Asset revision is not eligible for Phase v1 I2V' using errcode = '22023';
  end if;
  if revision_row.pixel_width * 16 <> revision_row.pixel_height * 9
    or p_duration_seconds <> 5 or p_resolution <> '720p' then
    raise exception 'Phase v1 I2V requires a 9:16 revision, 5 seconds, and 720p' using errcode = '22023';
  end if;

  select * into existing_run from revenue_lab.video_generation_runs
    where project_id = plan_row.project_id and idempotency_key = p_idempotency_key;
  if existing_run.id is not null then
    select * into existing_scene from revenue_lab.video_generation_scenes where run_id = existing_run.id limit 1;
    if existing_run.request_fingerprint <> p_request_fingerprint
      or existing_scene.generation_input_fingerprint <> p_generation_input_fingerprint then
      raise exception 'Idempotency key was reused with different I2V input' using errcode = '22023';
    end if;
    return jsonb_build_object('runId', existing_run.id, 'sceneGenerationId', existing_scene.id,
      'attemptNumber', existing_scene.attempt_number, 'status', existing_scene.status,
      'created', false, 'idempotentReplay', true);
  end if;

  select * into existing_scene from revenue_lab.video_generation_scenes
    where creative_production_plan_id = p_creative_production_plan_id
      and creative_scene_number = p_scene_number and provider = p_provider
      and requested_model = p_requested_model and generation_input_fingerprint = p_generation_input_fingerprint
      and (status in ('queued', 'submitting', 'polling', 'submission_uncertain') or not p_regenerate)
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
    creative_scene_number, attempt_number, provider, provider_version, provider_adapter_version,
    requested_model, prompt_snapshot, negative_prompt_snapshot, prompt_builder_version,
    prompt_fingerprint, generation_input_fingerprint, input_asset_id, input_asset_revision_id,
    input_asset_snapshot, generation_mode, duration_seconds, aspect_ratio, resolution, audio_enabled
  ) values (
    run_row.id, plan_row.project_id, plan_row.campaign_id, plan_row.campaign_iteration_id, plan_row.id,
    p_scene_number, next_attempt, p_provider, p_provider_version, p_provider_adapter_version,
    p_requested_model, p_positive_prompt, p_negative_prompt, p_prompt_builder_version,
    p_prompt_fingerprint, p_generation_input_fingerprint, revision_row.product_asset_id, revision_row.id,
    jsonb_build_object(
      'product_asset_id', revision_row.product_asset_id, 'asset_revision_id', revision_row.id,
      'revision_number', revision_row.revision_number, 'content_sha256', revision_row.content_sha256,
      'content_type', revision_row.content_type, 'byte_size', revision_row.byte_size,
      'pixel_width', revision_row.pixel_width, 'pixel_height', revision_row.pixel_height,
      'permission_snapshot', revision_row.permission_snapshot,
      'i2v_allowed_snapshot', revision_row.i2v_allowed_snapshot,
      'source_url_snapshot', revision_row.source_url_snapshot,
      'parent_revision_id', revision_row.parent_revision_id,
      'derivation_type', revision_row.derivation_type,
      'derivation_spec', revision_row.derivation_spec,
      'transformation_fingerprint', revision_row.transformation_fingerprint,
      'storage_provider', revision_row.storage_provider, 'storage_bucket', revision_row.storage_bucket,
      'immutable_object_key', revision_row.immutable_object_key
    ), 'image_to_video', p_duration_seconds, '9:16', p_resolution, false
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

revoke all privileges on revenue_lab.product_asset_revisions from public, anon, authenticated;
revoke all privileges on revenue_lab.product_asset_revisions from service_role;
grant select, insert on revenue_lab.product_asset_revisions to service_role;
revoke execute on function revenue_lab.register_product_asset_revision(uuid, text, text, text, text, text, text, bigint, integer, integer, boolean, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function revenue_lab.register_product_asset_revision(uuid, text, text, text, text, text, text, bigint, integer, integer, boolean, uuid, text, jsonb, text)
  to service_role;
revoke execute on function revenue_lab.enqueue_image_video_generation_scene(uuid, smallint, text, text, text, text, uuid, text, text, text, text, text, text, smallint, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_image_video_generation_scene(uuid, smallint, text, text, text, text, uuid, text, text, text, text, text, text, smallint, text, uuid, boolean)
  to service_role;

commit;
