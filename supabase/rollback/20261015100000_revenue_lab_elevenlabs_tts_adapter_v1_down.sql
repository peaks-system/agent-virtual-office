begin;

do $$ begin
  if exists (select 1 from revenue_lab.creative_audio_artifacts where status <> 'planned') then
    raise exception 'Reset or remove generated Creative Audio Artifacts before rollback';
  end if;
end $$;

delete from revenue_lab.jobs where job_type = 'creative.audio.generate';
drop function if exists revenue_lab.fail_creative_audio_generation_v1(uuid, text, text, text, text, text, integer);
drop function if exists revenue_lab.complete_creative_audio_generation_v1(uuid, text, text, numeric, bigint, text, text, integer);
drop function if exists revenue_lab.record_creative_audio_provider_receipt_v1(uuid, text, text, numeric, bigint, text, text, integer);
drop function if exists revenue_lab.claim_creative_audio_generation_v1(uuid, text);
drop function if exists revenue_lab.enqueue_creative_audio_generation_v1(uuid, text, text, text, text, text, jsonb, text, text, uuid);
drop trigger if exists guard_creative_audio_artifact_state_transition_trigger on revenue_lab.creative_audio_artifacts;
drop function if exists revenue_lab.guard_creative_audio_artifact_state_transition();

alter table revenue_lab.creative_audio_artifacts drop constraint creative_audio_artifacts_ready_check;
alter table revenue_lab.creative_audio_artifacts drop constraint creative_audio_artifacts_generation_fingerprint_unique;
alter table revenue_lab.creative_audio_artifacts drop constraint creative_audio_artifacts_status_check;
alter table revenue_lab.creative_audio_artifacts
  drop column generation_started_at,
  drop column provider_responded_at,
  drop column provider_character_cost,
  drop column provider_trace_id,
  drop column provider_request_id,
  drop column stable_seed,
  drop column byte_size,
  drop column content_type,
  drop column output_format,
  drop column fingerprint_schema_version,
  drop column generation_fingerprint,
  drop column provider_adapter_version,
  add constraint creative_audio_artifacts_status_check check (status in ('planned', 'generating', 'ready', 'failed')),
  add constraint creative_audio_artifacts_ready_check check (
    status <> 'ready' or (provider is not null and model is not null and voice is not null
      and audio_sha256 is not null and duration_seconds is not null and storage_provider is not null
      and storage_bucket is not null and immutable_object_key is not null and completed_at is not null)
  );
grant update on revenue_lab.creative_audio_artifacts to service_role;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description', 'creative.production.plan',
    'video.generate.scene', 'creative.archetype.plan', 'creative.compose.final'));

commit;
