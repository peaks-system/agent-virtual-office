begin;

do $$
begin
  if exists (select 1 from revenue_lab.video_generation_runs)
    or exists (select 1 from revenue_lab.video_generation_scenes) then
    raise exception 'Rollback blocked: video generation evidence must not be discarded';
  end if;
end;
$$;

drop function if exists revenue_lab.enqueue_video_generation_scene(uuid, smallint, text, text, text, text, text, smallint, text, uuid, boolean);
drop table if exists revenue_lab.video_generation_scenes;
drop table if exists revenue_lab.video_generation_runs;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description', 'creative.production.plan'));

commit;
