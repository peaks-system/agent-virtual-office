begin;

do $$
begin
  if exists (select 1 from revenue_lab.creative_production_requests)
    or exists (select 1 from revenue_lab.creative_production_plans) then
    raise exception 'Rollback blocked: immutable Creative Production revisions must not be discarded';
  end if;
end;
$$;

drop function if exists revenue_lab.enqueue_creative_production_plan(uuid, jsonb, text, text, text, text, uuid);
drop table if exists revenue_lab.creative_production_plans;
drop function if exists revenue_lab.prevent_creative_production_plan_mutation();
drop table if exists revenue_lab.creative_production_requests;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description'));

commit;
