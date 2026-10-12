begin;

do $$
begin
  if exists (select 1 from revenue_lab.product_asset_revisions)
    or exists (select 1 from revenue_lab.video_generation_scenes where generation_mode = 'image_to_video') then
    raise exception 'Rollback blocked: Image-to-Video evidence exists';
  end if;
end;
$$;

drop function if exists revenue_lab.enqueue_image_video_generation_scene(uuid, smallint, text, text, text, text, uuid, text, text, text, text, text, text, smallint, text, uuid, boolean);
drop function if exists revenue_lab.register_product_asset_revision(uuid, text, text, text, text, text, text, bigint, integer, integer, boolean, uuid, text, jsonb, text);

drop index if exists revenue_lab.video_generation_scenes_one_active_idx;
create unique index video_generation_scenes_one_active_idx
  on revenue_lab.video_generation_scenes(creative_production_plan_id, creative_scene_number, provider, requested_model, prompt_fingerprint)
  where status in ('queued', 'submitting', 'polling');
drop index if exists revenue_lab.video_generation_scenes_asset_revision_idx;

alter table revenue_lab.video_generation_scenes
  drop constraint if exists video_generation_scenes_i2v_shape_check,
  drop constraint if exists video_generation_scenes_generation_mode_check,
  drop constraint if exists video_generation_scenes_status_check;
alter table revenue_lab.video_generation_scenes
  add constraint video_generation_scenes_status_check check (status in ('queued', 'submitting', 'polling', 'succeeded', 'failed'));
alter table revenue_lab.video_generation_scenes
  drop column submission_uncertain,
  drop column provider_adapter_version,
  drop column generation_input_fingerprint,
  drop column prompt_builder_version,
  drop column negative_prompt_snapshot,
  drop column input_asset_snapshot,
  drop column input_asset_revision_id,
  drop column generation_mode;

alter table revenue_lab.video_generation_runs drop constraint if exists video_generation_runs_status_check;
alter table revenue_lab.video_generation_runs add constraint video_generation_runs_status_check
  check (status in ('queued', 'running', 'succeeded', 'failed'));

drop table revenue_lab.product_asset_revisions;

commit;
