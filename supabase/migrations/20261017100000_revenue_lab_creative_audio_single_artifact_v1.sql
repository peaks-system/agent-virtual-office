begin;

create function revenue_lab.enqueue_creative_audio_artifact_generation_v1(
  p_artifact_id uuid, p_provider text, p_provider_adapter_version text,
  p_model text, p_voice text, p_output_format text, p_voice_settings jsonb,
  p_fingerprint_schema_version text, p_storage_bucket text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  artifact revenue_lab.creative_audio_artifacts;
  plan revenue_lab.creative_archetype_plans;
  generation_fingerprint_value text;
  seed_value integer;
  inserted_count integer := 0;
begin
  if nullif(btrim(p_idempotency_key), '') is null or char_length(p_idempotency_key) > 160 then
    raise exception 'Invalid Creative Audio idempotency key' using errcode = '22023';
  end if;

  select audio.* into artifact
  from revenue_lab.creative_audio_artifacts audio
  where audio.id = p_artifact_id
  for update;
  if artifact.id is null then
    raise exception 'Creative Audio Artifact was not found' using errcode = 'P0002';
  end if;

  select archetype_plan.* into plan
  from revenue_lab.creative_archetype_plans archetype_plan
  where archetype_plan.id = artifact.creative_archetype_plan_id;
  if plan.id is null or plan.archetype <> 'three_picks_v2' then
    raise exception 'Creative Audio Artifact must belong to Three Picks v2' using errcode = '22023';
  end if;
  if artifact.status <> 'planned' then
    raise exception 'Creative Audio Artifact is not planned' using errcode = '55000';
  end if;
  if artifact.input_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Creative Audio Artifact input fingerprint is invalid' using errcode = '22023';
  end if;
  if p_provider <> 'elevenlabs' or p_provider_adapter_version <> 'elevenlabs-tts-adapter-v1'
    or nullif(btrim(p_model), '') is null or nullif(btrim(p_voice), '') is null
    or p_output_format <> 'mp3_44100_128' or p_storage_bucket <> 'revenue-lab-creative-audio'
    or jsonb_typeof(p_voice_settings) <> 'object' or nullif(btrim(p_fingerprint_schema_version), '') is null then
    raise exception 'Invalid ElevenLabs TTS configuration' using errcode = '22023';
  end if;

  generation_fingerprint_value := encode(extensions.digest(convert_to(jsonb_build_object(
    'artifact_id', artifact.id, 'input_sha256', artifact.input_sha256,
    'provider', p_provider, 'adapter_version', p_provider_adapter_version,
    'model', p_model, 'voice', p_voice, 'output_format', p_output_format,
    'voice_settings', p_voice_settings, 'apply_language_text_normalization', true,
    'seed_algorithm', 'sha256-first-31-bits-v1',
    'fingerprint_schema_version', p_fingerprint_schema_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  if generation_fingerprint_value !~ '^[0-9a-f]{64}$' then
    raise exception 'Creative Audio generation fingerprint is invalid' using errcode = '22023';
  end if;
  if artifact.generation_fingerprint is not null
    and artifact.generation_fingerprint <> generation_fingerprint_value then
    raise exception 'Audio artifact configuration cannot change after generation is scheduled' using errcode = '55000';
  end if;
  seed_value := (('x' || substr(generation_fingerprint_value, 1, 8))::bit(32)::bigint % 2147483648)::integer;

  update revenue_lab.creative_audio_artifacts set
    provider = p_provider, provider_adapter_version = p_provider_adapter_version,
    model = p_model, voice = p_voice, output_format = p_output_format,
    content_type = 'audio/mpeg', stable_seed = seed_value,
    generation_fingerprint = generation_fingerprint_value,
    fingerprint_schema_version = p_fingerprint_schema_version,
    storage_provider = 'supabase-storage', storage_bucket = p_storage_bucket,
    immutable_object_key = 'creative-audio/' || plan.id::text || '/' || artifact.segment_id || '/' || generation_fingerprint_value || '.mp3',
    safe_error_code = null
  where id = artifact.id and status = 'planned';

  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
  values (plan.project_id, 'creative.audio.generate',
    jsonb_build_object('creative_audio_artifact_id', artifact.id, 'generation_fingerprint', generation_fingerprint_value),
    'creative.audio.generate.v1:' || artifact.id::text || ':' || generation_fingerprint_value, 1)
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;

  return jsonb_build_object('artifactId', artifact.id, 'planId', plan.id,
    'idempotencyKey', p_idempotency_key, 'createdCount', inserted_count,
    'created', inserted_count = 1);
end;
$$;

revoke all on function revenue_lab.enqueue_creative_audio_artifact_generation_v1(uuid, text, text, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_creative_audio_artifact_generation_v1(uuid, text, text, text, text, text, jsonb, text, text, text) to service_role;

commit;
