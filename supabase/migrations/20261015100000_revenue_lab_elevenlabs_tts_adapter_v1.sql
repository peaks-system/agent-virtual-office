begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description', 'creative.production.plan',
    'video.generate.scene', 'creative.archetype.plan', 'creative.compose.final', 'creative.audio.generate'));

alter table revenue_lab.creative_audio_artifacts drop constraint creative_audio_artifacts_status_check;
alter table revenue_lab.creative_audio_artifacts drop constraint creative_audio_artifacts_ready_check;
alter table revenue_lab.creative_audio_artifacts
  add column provider_adapter_version text,
  add column generation_fingerprint text check (generation_fingerprint is null or generation_fingerprint ~ '^[0-9a-f]{64}$'),
  add column fingerprint_schema_version text,
  add column output_format text,
  add column content_type text,
  add column byte_size bigint check (byte_size is null or byte_size > 0),
  add column stable_seed integer check (stable_seed is null or stable_seed between 0 and 2147483647),
  add column provider_request_id text,
  add column provider_trace_id text,
  add column provider_character_cost integer check (provider_character_cost is null or provider_character_cost >= 0),
  add column generation_started_at timestamptz,
  add column provider_responded_at timestamptz,
  add constraint creative_audio_artifacts_status_check
    check (status in ('planned', 'generating', 'ready', 'failed', 'submission_uncertain')),
  add constraint creative_audio_artifacts_generation_fingerprint_unique unique (generation_fingerprint),
  add constraint creative_audio_artifacts_ready_check check (
    status <> 'ready' or (provider = 'elevenlabs' and provider_adapter_version = 'elevenlabs-tts-adapter-v1'
      and model is not null and voice is not null and output_format = 'mp3_44100_128'
      and content_type = 'audio/mpeg' and byte_size is not null and stable_seed is not null
      and generation_fingerprint is not null and audio_sha256 is not null and duration_seconds is not null
      and storage_provider is not null and storage_bucket = 'revenue-lab-creative-audio'
      and immutable_object_key is not null and provider_request_id is not null
      and provider_responded_at is not null and completed_at is not null)
  );

create function revenue_lab.guard_creative_audio_artifact_state_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then raise exception 'Creative Audio Artifact must start as planned' using errcode = '23514'; end if;
    return new;
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'planned' and new.status = 'generating')
    or (old.status = 'generating' and new.status in ('ready', 'failed', 'submission_uncertain'))
  ) then raise exception 'Invalid Creative Audio Artifact state transition' using errcode = '55000'; end if;
  if old.status <> 'planned' and (
    new.provider is distinct from old.provider or new.provider_adapter_version is distinct from old.provider_adapter_version
    or new.model is distinct from old.model or new.voice is distinct from old.voice
    or new.generation_fingerprint is distinct from old.generation_fingerprint
    or new.fingerprint_schema_version is distinct from old.fingerprint_schema_version
    or new.output_format is distinct from old.output_format or new.stable_seed is distinct from old.stable_seed
    or new.storage_bucket is distinct from old.storage_bucket or new.immutable_object_key is distinct from old.immutable_object_key
  ) then raise exception 'Creative Audio generation configuration is immutable after claim' using errcode = '55000'; end if;
  return new;
end;
$$;
create trigger guard_creative_audio_artifact_state_transition_trigger
  before insert or update on revenue_lab.creative_audio_artifacts
  for each row execute function revenue_lab.guard_creative_audio_artifact_state_transition();

create function revenue_lab.enqueue_creative_audio_generation_v1(
  p_creative_archetype_plan_id uuid, p_provider text, p_provider_adapter_version text,
  p_model text, p_voice text, p_output_format text, p_voice_settings jsonb,
  p_fingerprint_schema_version text, p_storage_bucket text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan_row revenue_lab.creative_archetype_plans;
declare artifact_row revenue_lab.creative_audio_artifacts;
declare generation_fingerprint_value text; declare seed_value integer;
declare created_count integer := 0; declare inserted_count integer := 0; declare total_count integer := 0;
begin
  select * into plan_row from revenue_lab.creative_archetype_plans
    where id = p_creative_archetype_plan_id and archetype = 'three_picks_v2';
  if plan_row.id is null then raise exception 'Creative Archetype v2 plan was not found' using errcode = 'P0002'; end if;
  if p_provider <> 'elevenlabs' or p_provider_adapter_version <> 'elevenlabs-tts-adapter-v1'
    or nullif(btrim(p_model), '') is null or nullif(btrim(p_voice), '') is null
    or p_output_format <> 'mp3_44100_128' or p_storage_bucket <> 'revenue-lab-creative-audio'
    or jsonb_typeof(p_voice_settings) <> 'object' or nullif(btrim(p_fingerprint_schema_version), '') is null then
    raise exception 'Invalid ElevenLabs TTS configuration' using errcode = '22023';
  end if;

  select count(*) into total_count from revenue_lab.creative_audio_artifacts
    where creative_archetype_plan_id = plan_row.id;
  if total_count = 0 then raise exception 'Narration artifacts were not found' using errcode = 'P0002'; end if;

  for artifact_row in select * from revenue_lab.creative_audio_artifacts
    where creative_archetype_plan_id = plan_row.id order by scene_id, segment_order for update loop
    generation_fingerprint_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'artifact_id', artifact_row.id, 'input_sha256', artifact_row.input_sha256,
      'provider', p_provider, 'adapter_version', p_provider_adapter_version,
      'model', p_model, 'voice', p_voice, 'output_format', p_output_format,
      'voice_settings', p_voice_settings, 'apply_language_text_normalization', true,
      'seed_algorithm', 'sha256-first-31-bits-v1',
      'fingerprint_schema_version', p_fingerprint_schema_version
    )::text, 'UTF8'), 'sha256'), 'hex');
    seed_value := (('x' || substr(generation_fingerprint_value, 1, 8))::bit(32)::bigint % 2147483648)::integer;

    if artifact_row.generation_fingerprint is not null
      and artifact_row.generation_fingerprint <> generation_fingerprint_value then
      raise exception 'Audio artifact configuration cannot change after generation is scheduled' using errcode = '55000';
    end if;
    if artifact_row.status <> 'planned' then
      continue;
    end if;

    update revenue_lab.creative_audio_artifacts set
      provider = p_provider, provider_adapter_version = p_provider_adapter_version,
      model = p_model, voice = p_voice, output_format = p_output_format,
      content_type = 'audio/mpeg', stable_seed = seed_value,
      generation_fingerprint = generation_fingerprint_value,
      fingerprint_schema_version = p_fingerprint_schema_version,
      storage_provider = 'supabase-storage', storage_bucket = p_storage_bucket,
      immutable_object_key = 'creative-audio/' || plan_row.id::text || '/' || artifact_row.segment_id || '/' || generation_fingerprint_value || '.mp3',
      safe_error_code = null
    where id = artifact_row.id;
    insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
    values (plan_row.project_id, 'creative.audio.generate',
      jsonb_build_object('creative_audio_artifact_id', artifact_row.id, 'generation_fingerprint', generation_fingerprint_value),
      'creative.audio.generate.v1:' || artifact_row.id::text || ':' || generation_fingerprint_value, 2)
    on conflict (idempotency_key) do nothing;
    get diagnostics inserted_count = row_count;
    created_count := created_count + inserted_count;
  end loop;
  return jsonb_build_object('planId', plan_row.id, 'idempotencyKey', p_idempotency_key,
    'artifactCount', total_count, 'createdCount', created_count, 'created', created_count > 0);
end;
$$;

create function revenue_lab.claim_creative_audio_generation_v1(
  p_artifact_id uuid, p_generation_fingerprint text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare artifact_row revenue_lab.creative_audio_artifacts;
begin
  update revenue_lab.creative_audio_artifacts set status = 'generating', generation_started_at = now(), safe_error_code = null
    where id = p_artifact_id and generation_fingerprint = p_generation_fingerprint and status = 'planned'
    returning * into artifact_row;
  if artifact_row.id is not null then return jsonb_build_object('claimed', true, 'artifact', to_jsonb(artifact_row)); end if;
  select * into artifact_row from revenue_lab.creative_audio_artifacts where id = p_artifact_id;
  if artifact_row.id is null then raise exception 'Creative Audio Artifact was not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('claimed', false, 'artifact', to_jsonb(artifact_row));
end;
$$;

create function revenue_lab.complete_creative_audio_generation_v1(
  p_artifact_id uuid, p_generation_fingerprint text, p_audio_sha256 text,
  p_duration_seconds numeric, p_byte_size bigint, p_provider_request_id text,
  p_provider_trace_id text, p_provider_character_cost integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare artifact_row revenue_lab.creative_audio_artifacts;
begin
  update revenue_lab.creative_audio_artifacts set status = 'ready', audio_sha256 = coalesce(audio_sha256, p_audio_sha256),
    duration_seconds = coalesce(duration_seconds, p_duration_seconds), byte_size = coalesce(byte_size, p_byte_size),
    provider_request_id = coalesce(provider_request_id, p_provider_request_id),
    provider_trace_id = coalesce(provider_trace_id, nullif(p_provider_trace_id, '')),
    provider_character_cost = coalesce(provider_character_cost, p_provider_character_cost),
    provider_responded_at = coalesce(provider_responded_at, now()),
    safe_error_code = null, completed_at = now()
  where id = p_artifact_id and generation_fingerprint = p_generation_fingerprint and status = 'generating'
    and p_audio_sha256 ~ '^[0-9a-f]{64}$' and p_duration_seconds > 0 and p_byte_size > 0
    and nullif(btrim(p_provider_request_id), '') is not null
    and (audio_sha256 is null or audio_sha256 = p_audio_sha256)
    and (provider_request_id is null or provider_request_id = p_provider_request_id)
    returning * into artifact_row;
  if artifact_row.id is null then raise exception 'Creative Audio Artifact is not in generating state' using errcode = '55000'; end if;
  return to_jsonb(artifact_row);
end;
$$;

create function revenue_lab.record_creative_audio_provider_receipt_v1(
  p_artifact_id uuid, p_generation_fingerprint text, p_audio_sha256 text,
  p_duration_seconds numeric, p_byte_size bigint, p_provider_request_id text,
  p_provider_trace_id text, p_provider_character_cost integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare artifact_row revenue_lab.creative_audio_artifacts;
begin
  update revenue_lab.creative_audio_artifacts set audio_sha256 = p_audio_sha256,
    duration_seconds = p_duration_seconds, byte_size = p_byte_size,
    provider_request_id = p_provider_request_id, provider_trace_id = nullif(p_provider_trace_id, ''),
    provider_character_cost = p_provider_character_cost, provider_responded_at = now()
  where id = p_artifact_id and generation_fingerprint = p_generation_fingerprint and status = 'generating'
    and p_audio_sha256 ~ '^[0-9a-f]{64}$' and p_duration_seconds > 0 and p_byte_size > 0
    and nullif(btrim(p_provider_request_id), '') is not null and provider_request_id is null
    returning * into artifact_row;
  if artifact_row.id is null then raise exception 'Creative Audio Artifact is not in generating state' using errcode = '55000'; end if;
  return to_jsonb(artifact_row);
end;
$$;

create function revenue_lab.fail_creative_audio_generation_v1(
  p_artifact_id uuid, p_generation_fingerprint text, p_status text, p_safe_error_code text,
  p_provider_request_id text default null, p_provider_trace_id text default null,
  p_provider_character_cost integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare artifact_row revenue_lab.creative_audio_artifacts;
begin
  if p_status not in ('failed', 'submission_uncertain') then raise exception 'Invalid Creative Audio terminal status' using errcode = '22023'; end if;
  update revenue_lab.creative_audio_artifacts set status = p_status,
    safe_error_code = left(coalesce(nullif(p_safe_error_code, ''), 'TTS_GENERATION_FAILED'), 80),
    provider_request_id = coalesce(provider_request_id, nullif(p_provider_request_id, '')),
    provider_trace_id = coalesce(provider_trace_id, nullif(p_provider_trace_id, '')),
    provider_character_cost = coalesce(provider_character_cost, p_provider_character_cost),
    provider_responded_at = case when p_provider_request_id is not null then now() else provider_responded_at end,
    completed_at = now()
  where id = p_artifact_id and generation_fingerprint = p_generation_fingerprint and status = 'generating'
  returning * into artifact_row;
  if artifact_row.id is null then raise exception 'Creative Audio Artifact is not in generating state' using errcode = '55000'; end if;
  return to_jsonb(artifact_row);
end;
$$;

revoke update on revenue_lab.creative_audio_artifacts from service_role;
revoke all on function revenue_lab.enqueue_creative_audio_generation_v1(uuid, text, text, text, text, text, jsonb, text, text, uuid) from public, anon, authenticated;
revoke all on function revenue_lab.claim_creative_audio_generation_v1(uuid, text) from public, anon, authenticated;
revoke all on function revenue_lab.complete_creative_audio_generation_v1(uuid, text, text, numeric, bigint, text, text, integer) from public, anon, authenticated;
revoke all on function revenue_lab.record_creative_audio_provider_receipt_v1(uuid, text, text, numeric, bigint, text, text, integer) from public, anon, authenticated;
revoke all on function revenue_lab.fail_creative_audio_generation_v1(uuid, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_creative_audio_generation_v1(uuid, text, text, text, text, text, jsonb, text, text, uuid) to service_role;
grant execute on function revenue_lab.claim_creative_audio_generation_v1(uuid, text) to service_role;
grant execute on function revenue_lab.complete_creative_audio_generation_v1(uuid, text, text, numeric, bigint, text, text, integer) to service_role;
grant execute on function revenue_lab.record_creative_audio_provider_receipt_v1(uuid, text, text, numeric, bigint, text, text, integer) to service_role;
grant execute on function revenue_lab.fail_creative_audio_generation_v1(uuid, text, text, text, text, text, integer) to service_role;

commit;
